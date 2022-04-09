import createHttpError from 'http-errors';
import { ApiResponse } from 'interfaces';
import { NextApiHandler, NextApiRequest } from 'next';

export const catchAsync =
    (handler: NextApiHandler) => (req: NextApiRequest, res: ApiResponse) => {
        return (handler(req, res) as Promise<void>).catch(
            (error: createHttpError.HttpError) => {
                error.name === 'JsonWebTokenError' &&
                    (error = createHttpError(401, 'Invalid token!'));
                error.name === 'TokenExpiredError' &&
                    (error = createHttpError(401, 'Token has been expired!'));

                const statusCode = error.statusCode || 500;
                const message = error.message || 'Something went wrong!';

                if (process.env.NODE_ENV === 'development') {
                    console.log('-------------------------');
                    console.error(error);
                    console.log('-------------------------');
                }

                return res.status(statusCode).json({ message });
            }
        );
    };
