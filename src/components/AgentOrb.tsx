/**
 * AgentOrb — the animated circle that shows what the agent is doing.
 * Pure presentation: the animation is driven by the `state` prop via CSS.
 */
import type { AgentState } from '../types';

interface Props {
  state: AgentState;
  active: boolean;
}

export function AgentOrb({ state, active }: Props) {
  const animation = active ? state : 'idle';

  return (
    <div className={`orb orb--${animation}`} aria-hidden="true">
      {/* Pulsing ring behind the orb while listening/speaking */}
      {active && (state === 'listening' || state === 'speaking') && <div className="orb__ring" />}

      <div className="orb__core">
        {active && state === 'thinking' ? (
          <span className="orb__dots">
            <i /><i /><i />
          </span>
        ) : (
          <span className="orb__bars">
            <i /><i /><i /><i />
          </span>
        )}
      </div>
    </div>
  );
}
