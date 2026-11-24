import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

/** Shared accounts; retain the collection and model name for existing staff. */
const staffUserSchema = new Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      required: true,
      enum: ['customer', 'staff', 'admin'],
      default: 'staff',
    },
    name: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: null },
  },
  { timestamps: true, collection: 'staffUsers' },
);

export type StaffUserAttributes = InferSchemaType<typeof staffUserSchema>;
export type StaffUserDocument = HydratedDocument<StaffUserAttributes>;

export const StaffUser = model<StaffUserAttributes>('StaffUser', staffUserSchema);
