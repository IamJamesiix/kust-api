// throw new AppError(404, 'NOT_FOUND', 'Budget not found')
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}
