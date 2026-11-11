import { AppError } from './errors.js';
export class Gate {
  active = 0;
  constructor(private readonly max: number) {}
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) throw new AppError('BUSY','Hay varias descargas en curso. Inténtalo de nuevo en unos segundos.',503);
    this.active++;
    try { return await work(); } finally { this.active--; }
  }
}
