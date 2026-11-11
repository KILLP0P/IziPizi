export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export const aborted = () => new AppError('CANCELLED', 'La operación se ha cancelado.', 499);
