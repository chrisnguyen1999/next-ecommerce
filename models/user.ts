import bcrypt from 'bcryptjs';
import createHttpError from 'http-errors';
import { HasId, UserDB, UserRole } from 'interfaces';
import jwt from 'jsonwebtoken';
import { DAY_EXPIRE } from 'lib';
import mongoose, { Document, Model, Schema } from 'mongoose';
import { promisify } from 'util';

export interface UserDocument extends UserDB, Document {
    comparePassword: (
        password: string,
        userPassword: string
    ) => Promise<boolean>;
    generateToken: () => Promise<string>;
}

interface UserModel extends Model<UserDocument> {
    findByCredentials: (
        email: string,
        password: string
    ) => Promise<UserDocument>;
    findMyOrders: (id: string) => Promise<UserDocument>;
    updatePassword: (
        id: string,
        password: string,
        newPassword: string
    ) => Promise<void>;
}

const trimmedString = { type: String, trim: true };

const userSchema: Schema<UserDocument, UserModel> = new Schema(
    {
        name: {
            ...trimmedString,
            required: [true, 'Name field must be required!'],
            validate: {
                validator: (val: string) => {
                    const valArray = val.split(' ');
                    return !!(valArray[0] && valArray[1]);
                },
                message: 'Name contains at least 2 words!',
            },
        },
        email: {
            ...trimmedString,
            required: [true, 'Email field must be required!'],
            match: [
                /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
                'Invalid email!',
            ],
            unique: true,
        },
        password: {
            ...trimmedString,
            required: [true, 'Password field must be required!'],
            minlength: 6,
            select: false,
        },
        confirmPassword: {
            ...trimmedString,
            required: [true, 'Confirm password field must be required!'],
            validate: {
                validator: function (this: UserDocument, val: string) {
                    return val === this.password;
                },
                message: 'Password and confirm password does not match!',
            },
            select: false,
        },
        role: {
            type: String,
            enum: {
                values: Object.values(UserRole),
                message: 'Role is either: user, admin',
            },
            default: UserRole.USER,
        },
        avatar: {
            type: String,
            default: '/img/user/default.jpg',
        },
    },
    {
        timestamps: true,
        toJSON: {
            virtuals: true,
            transform(_doc, ret) {
                delete ret.password;
                delete ret.confirmPassword;
                delete ret.__v;
                return ret;
            },
        },
        toObject: { virtuals: true },
        id: false,
    }
);

userSchema.virtual('orders', {
    ref: 'Order',
    foreignField: 'user',
    localField: '_id',
});

userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();

    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    this.confirmPassword = '';

    next();
});

userSchema.statics.findMyOrders = async function (id: string) {
    const user = await this.findById(id).populate({
        path: 'orders',
        select: '-user -cart.product address mobile total delivery paid paymentDate',
    });

    if (!user) {
        throw createHttpError(400, `No user with this id: ${id}`);
    }

    return user;
};

userSchema.statics.findByCredentials = async function (
    email: string,
    password: string
) {
    const user = await this.findOne({ email }).select('+password');
    if (!user) {
        throw createHttpError(400, 'Invalid email!');
    }

    const comparePassword = await user.comparePassword(password, user.password);
    if (!comparePassword) {
        throw createHttpError(400, 'Wrong password!');
    }

    return user;
};

userSchema.statics.updatePassword = async function (
    id: string,
    password: string,
    newPassword: string
) {
    const user = await this.findById(id).select('+password');
    if (!user) {
        throw createHttpError(400, 'Invalid email!');
    }

    const comparePassword = await user.comparePassword(password, user.password);

    if (!comparePassword) {
        throw createHttpError(400, 'Wrong password!');
    }

    user.password = newPassword;
    user.confirmPassword = newPassword;

    await user.save();
};

userSchema.methods.comparePassword = (
    password: string,
    userPassword: string
) => {
    return bcrypt.compare(password, userPassword);
};

userSchema.methods.generateToken = function (
    this: UserDocument & { _id: any }
) {
    if (!process.env.SECRET_KEY) {
        throw createHttpError(503, 'Cannot create access token!');
    }

    const encodeAsync = promisify(jwt.sign) as any;

    return encodeAsync({ id: this._id }, process.env.SECRET_KEY, {
        expiresIn: `${DAY_EXPIRE}d`,
    });
};

export const User =
    (mongoose.models?.User as UserModel) ||
    mongoose.model<UserDocument, UserModel>('User', userSchema);
