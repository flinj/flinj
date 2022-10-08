export default class AppError extends Error {
	/**
	 *
	 * @param {number} status - HTTP status code
	 * @param {string} body - Error message
	 */
	constructor(status, body) {
		super(body);
		this.status = status;
		this.isOperational = true;

		Error.captureStackTrace(this, this.constructor);
	}
}
