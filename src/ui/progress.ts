/** Hairline progress bar with a small stage label. */
export class Progress {
  private readonly bar: HTMLElement;
  private readonly label: HTMLElement;

  constructor(private readonly root: HTMLElement) {
    this.bar = root.querySelector('.bar')!;
    this.label = root.querySelector('.label')!;
  }

  show(stage: string, fraction?: number): void {
    this.root.hidden = false;
    const pct = fraction === undefined ? null : Math.round(Math.max(0, Math.min(1, fraction)) * 100);
    this.bar.style.width = pct === null ? '0' : `${pct}%`;
    this.label.textContent = pct === null ? `${stage}…` : `${stage} ${pct}%`;
  }

  hide(): void {
    this.root.hidden = true;
  }
}
