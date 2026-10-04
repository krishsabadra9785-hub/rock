import { app } from '../firebase/app';
import { EXTRACTION_PROMPT, parseExtraction, parseModelJson, type ParsedExtraction } from '../domain/extraction';
import { AppError, errorCode } from './errors';
import { MODEL_NAME_RE } from '../config/aiStatus';
import { prepareForAi } from './receiptImage';

/**
 * Receipt reading with Gemini through Firebase AI Logic.
 *
 * No API key lives in this code or in the repository: Firebase AI Logic
 * proxies the request using your Firebase project's configuration, and (if
 * configured) App Check proves the request comes from your real app.
 * See README → "Configure AI receipt reading".
 */

export interface ExtractionOutcome {
  parsed: ParsedExtraction;
  raw: string;
  model: string;
}

const TIMEOUT_MS = 45_000;

export async function extractReceipt(file: File, modelName: string): Promise<ExtractionOutcome> {
  if (!MODEL_NAME_RE.test(modelName.trim())) {
    throw new AppError('No AI model is configured. Set one in Settings → AI receipt reading, or enter the details manually.', 'ai/not-configured');
  }
  // Loaded lazily so the AI SDK isn't part of the initial download.
  const { getAI, getGenerativeModel, GoogleAIBackend, Schema } = await import('firebase/ai');

  const field = (valueSchema: ReturnType<typeof Schema.string>) =>
    Schema.object({
      properties: { value: valueSchema, confidence: Schema.number() },
      optionalProperties: ['value'],
    });

  const responseSchema = Schema.object({
    properties: {
      readable: Schema.boolean(),
      netQuantity: Schema.object({
        properties: {
          value: Schema.number({ nullable: true }),
          unit: Schema.enumString({ enum: ['MT', 'KG', 'QUINTAL'] }),
          confidence: Schema.number(),
        },
        optionalProperties: ['value', 'unit'],
      }),
      driverName: field(Schema.string({ nullable: true })),
      driverPhone: field(Schema.string({ nullable: true })),
      dispatchDate: field(Schema.string({ nullable: true })),
      vehicleNumber: field(Schema.string({ nullable: true })),
      receiptNumber: field(Schema.string({ nullable: true })),
      destination: field(Schema.string({ nullable: true })),
      notes: Schema.string(),
    },
    optionalProperties: ['notes'],
  });

  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const model = getGenerativeModel(ai, {
    model: modelName,
    generationConfig: { responseMimeType: 'application/json', responseSchema, temperature: 0 },
  });

  const { base64, mimeType } = await prepareForAi(file);

  let text: string;
  try {
    const result = await Promise.race([
      model.generateContent([EXTRACTION_PROMPT, { inlineData: { data: base64, mimeType } }]),
      new Promise<never>((_, reject) => setTimeout(() => reject(new AppError('Receipt reading timed out', 'ai/timeout')), TIMEOUT_MS)),
    ]);
    text = result.response.text();
  } catch (e) {
    throw new AppError(aiErrorMessage(e), 'ai/failed');
  }
  const parsed = parseExtraction(parseModelJson(text));
  return { parsed, raw: text, model: modelName };
}

/**
 * Sends one tiny text request (a few tokens of free quota) to check that
 * Firebase AI Logic + the Gemini Developer API answer for this project and model.
 */
export async function testAiConnection(modelName: string): Promise<string> {
  if (!MODEL_NAME_RE.test(modelName.trim())) throw new AppError('Enter a valid model name first', 'ai/not-configured');
  const { getAI, getGenerativeModel, GoogleAIBackend } = await import('firebase/ai');
  const model = getGenerativeModel(getAI(app, { backend: new GoogleAIBackend() }), { model: modelName.trim() });
  try {
    const result = await Promise.race([
      model.generateContent('Reply with the single word OK.'),
      new Promise<never>((_, reject) => setTimeout(() => reject(new AppError('The AI service did not answer in time', 'ai/timeout')), 20_000)),
    ]);
    return result.response.text().trim().slice(0, 40) || 'OK';
  } catch (e) {
    throw new AppError(aiErrorMessage(e), 'ai/failed');
  }
}

function aiErrorMessage(e: unknown): string {
  if (e instanceof AppError) return e.message;
  const code = errorCode(e);
  const msg = e instanceof Error ? e.message : '';
  if (/api-not-enabled|not been used|SERVICE_DISABLED|has not been enabled/i.test(msg) || code.includes('api-not-enabled')) {
    return 'AI receipt reading is not enabled for this Firebase project yet (README → Configure AI receipt reading).';
  }
  if (/app.?check/i.test(msg)) return 'AI request was blocked by App Check enforcement. Either finish App Check setup (README) or turn enforcement off for Firebase AI Logic.';
  if (/API_KEY_SERVICE_BLOCKED|api key not valid|are blocked|referer/i.test(msg)) {
    return 'The Firebase API key is not allowed to call Firebase AI Logic. Check the key restrictions in Google Cloud console (README → Troubleshooting).';
  }
  if (/quota|429|RESOURCE_EXHAUSTED/i.test(msg)) return 'AI usage limit reached for now. Enter the details manually.';
  if (/not found|404/i.test(msg)) return 'The configured AI model was not found. Check the model name in Settings → AI.';
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 'You are offline, so the receipt could not be read.';
  return 'The receipt could not be read automatically.';
}
