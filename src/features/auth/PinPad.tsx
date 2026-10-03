import { useCallback, useEffect, useState } from 'react';

/** 4-digit PIN entry with on-screen keypad and hardware keyboard support. */
export function PinPad({ onComplete, disabled, shake }: { onComplete: (pin: string) => void; disabled?: boolean; shake?: number }) {
  const [pin, setPin] = useState('');
  const [shaking, setShaking] = useState(false);

  useEffect(() => {
    if (!shake) return;
    setShaking(true);
    setPin('');
    const t = setTimeout(() => setShaking(false), 320);
    return () => clearTimeout(t);
  }, [shake]);

  const press = useCallback(
    (d: string) => {
      if (disabled || pin.length >= 4) return;
      const next = pin + d;
      setPin(next);
      if (next.length === 4) setTimeout(() => onComplete(next), 60);
    },
    [disabled, pin, onComplete],
  );
  const back = useCallback(() => setPin((p) => p.slice(0, -1)), []);

  useEffect(() => {
    if (disabled) setPin('');
  }, [disabled]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, back]);

  return (
    <div>
      <div className={`pin-dots ${shaking ? 'shake' : ''}`} aria-label={`${pin.length} of 4 digits entered`} role="status">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={i < pin.length ? 'filled' : ''} />
        ))}
      </div>
      <div className="keypad" style={{ marginTop: 18 }}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" onClick={() => press(d)} disabled={disabled}>
            {d}
          </button>
        ))}
        <span />
        <button type="button" onClick={() => press('0')} disabled={disabled}>
          0
        </button>
        <button type="button" className="key-muted" onClick={back} disabled={disabled} aria-label="Delete digit">
          Delete
        </button>
      </div>
    </div>
  );
}
