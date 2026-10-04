import { APP_NAME } from '../../config/brand';
import type { ReactNode } from 'react';

/** Layered strata — the visual signature of the sign-in screens. */
function Strata() {
  return (
    <svg className="strata" viewBox="0 0 800 400" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 120 C 160 80, 320 150, 480 110 S 720 70, 800 100 V400 H0Z" fill="#2B3A40" />
      <path d="M0 190 C 140 160, 300 220, 470 180 S 700 150, 800 175 V400 H0Z" fill="#33454C" />
      <path d="M0 260 C 180 235, 330 290, 500 255 S 710 230, 800 250 V400 H0Z" fill="#D9A21B" opacity="0.9" />
      <path d="M0 290 C 170 270, 340 320, 520 285 S 720 265, 800 280 V400 H0Z" fill="#3D5158" />
      <path d="M0 340 C 200 320, 360 365, 540 335 S 730 320, 800 330 V400 H0Z" fill="#1F6F5C" />
    </svg>
  );
}

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-screen">
      <div className="auth-art">
        <div className="wordmark" aria-label={APP_NAME}>
          Sabadra
          <br />
          Minerals
        </div>
        <p>Orders, ledgers and payments for your trading business — every rupee traced from buyer to payout.</p>
        <Strata />
      </div>
      <div className="auth-panel">{children}</div>
    </div>
  );
}
