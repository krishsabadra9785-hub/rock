import { APP_NAME } from '../../config/brand';
import type { ReactNode } from 'react';
import { BrandMark } from '../../components/Icon';

/** Layered strata — the visual signature of the sign-in screens. */
function Strata() {
  return (
    <svg className="strata" viewBox="0 0 800 400" preserveAspectRatio="none" aria-hidden="true">
      <path className="s1" d="M0 120 C 160 80, 320 150, 480 110 S 720 70, 800 100 V400 H0Z" />
      <path className="s2" d="M0 190 C 140 160, 300 220, 470 180 S 700 150, 800 175 V400 H0Z" />
      <path className="s3" d="M0 260 C 180 235, 330 290, 500 255 S 710 230, 800 250 V400 H0Z" />
      <path className="s4" d="M0 266 C 170 246, 340 296, 520 261 S 720 241, 800 256 V400 H0Z" />
      <path className="s5" d="M0 340 C 200 320, 360 365, 540 335 S 730 320, 800 330 V400 H0Z" />
    </svg>
  );
}

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-screen">
      <div className="auth-art">
        <div className="wordmark">
          <BrandMark size={36} /> {APP_NAME}
        </div>
        <p>Orders, ledgers and payments for your trading business — every rupee traced from buyer to payout.</p>
        <Strata />
      </div>
      <div className="auth-panel">{children}</div>
    </div>
  );
}
