import { ConfirmDialog } from "../shared/ConfirmDialog.tsx";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";

const SHORTCUTS: [string, string][] = [
  [`${MOD}+S`, "Format (when Format on save is on) and save a revision"],
  ["Shift+Alt+F", "Format with Prettier"],
  [`${MOD}+\\`, "Show or hide the statement panel"],
  ["Alt+↑ / Alt+↓", "Move the focused test"],
  ["?", "Show this list"],
];

export const ShortcutsDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => (
  <ConfirmDialog
    open={open}
    title="Keyboard shortcuts"
    confirmLabel="Done"
    onConfirm={onClose}
    onCancel={onClose}
  >
    <table className="shortcut-table">
      <tbody>
        {SHORTCUTS.map(([keys, action]) => (
          <tr key={keys}>
            <th scope="row">
              <kbd>{keys}</kbd>
            </th>
            <td>{action}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </ConfirmDialog>
);
