import { SHORTCUTS } from '../lib/shortcuts';

/** The keyboard shortcut list, as a dialog over the app. */
export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose} role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h3>Keyboard shortcuts</h3>
          <span className="grow" />
          <button className="quiet sm" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
        <table>
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.keys}>
                <td>{s.what}</td>
                <td>
                  {s.keys.split(' / ').map((combo, i) => (
                    <span key={combo}>
                      {i > 0 && ' / '}
                      {combo.split(' ').map((k) => (
                        <kbd key={k}>{k}</kbd>
                      ))}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted sm">Alt is the modifier because browsers keep most Ctrl combinations for themselves.</p>
      </div>
    </div>
  );
}
