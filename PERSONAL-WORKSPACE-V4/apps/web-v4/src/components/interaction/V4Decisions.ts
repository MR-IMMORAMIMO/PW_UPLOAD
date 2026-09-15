/** Shared asynchronous decisions; native dialog supplies focus trapping and Escape semantics. */
function decide(message: string, value?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = document.createElement('dialog');
    dialog.className = 'v4-decision-dialog';
    const anchor = previous?.getBoundingClientRect();
    const originX = anchor ? anchor.x + anchor.width / 2 - innerWidth / 2 : 0;
    const originY = anchor ? anchor.y + anchor.height / 2 - innerHeight / 2 : 20;
    dialog.style.setProperty('--v4-unfold-x', `${originX}px`);
    dialog.style.setProperty('--v4-unfold-y', `${originY}px`);
    const prompt = value !== undefined;
    const destructive = !prompt && /^(Delete|Discard|Reset)\b/i.test(message);
    dialog.setAttribute('aria-label', prompt ? 'Enter value' : 'Confirm action');
    dialog.setAttribute('aria-modal', 'true');
    if (destructive) dialog.setAttribute('role', 'alertdialog');
    const title = document.createElement('h3');
    title.textContent = prompt ? 'Enter value' : 'Confirm action';
    const description = document.createElement('p');
    description.id = `decision-${crypto.randomUUID()}`;
    description.textContent = message;
    dialog.setAttribute('aria-describedby', description.id);
    const input = document.createElement('input');
    input.value = value ?? '';
    input.setAttribute('aria-label', message);
    const actions = document.createElement('div');
    actions.className = 'v4-decision-dialog__actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const accept = document.createElement('button');
    accept.type = 'button';
    accept.textContent = prompt ? 'Save' : destructive ? message.split(' ')[0]! : 'Continue';
    accept.dataset.variant = destructive ? 'danger' : 'primary';
    actions.append(cancel, accept);
    dialog.append(title, description);
    if (prompt) dialog.append(input);
    dialog.append(actions);
    document.body.append(dialog);
    let closing = false;
    const finish = async (result: string | null) => {
      if (closing) return;
      closing = true;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!reduced && dialog.animate) {
        await dialog
          .animate(
            [
              { opacity: 1, transform: 'none' },
              {
                opacity: 0,
                transform: `perspective(1400px) translate(${originX}px, ${originY}px) rotateX(-14deg) scale(.12,.06)`,
              },
            ],
            { duration: 300, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' },
          )
          .finished.catch(() => undefined);
      }
      dialog.close();
      dialog.remove();
      if (previous?.isConnected) previous.focus();
      resolve(result);
    };
    cancel.onclick = () => void finish(null);
    accept.onclick = () => void finish(prompt ? input.value : 'confirmed');
    dialog.oncancel = (event) => {
      event.preventDefault();
      void finish(null);
    };
    input.onkeydown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void finish(input.value);
      }
    };
    dialog.onkeydown = (event) => {
      if (event.key === 'Escape' || event.key === 'Tab') event.stopPropagation();
    };
    dialog.showModal();
    (prompt ? input : cancel).focus();
    if (prompt) input.select();
  });
}
export const v4Decisions = {
  confirm: async (message: string) => (await decide(message)) !== null,
  prompt: (message: string, value = '') => decide(message, value),
};
declare global {
  interface Window {
    sctDecisions: typeof v4Decisions;
  }
}
if (typeof window !== 'undefined') window.sctDecisions = v4Decisions;
