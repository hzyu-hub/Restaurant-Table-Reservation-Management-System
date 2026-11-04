import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

/** Staff accounts. Authentication is Sprint 3; this model only stores the record. */
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
      enum: ['staff', 'admin'],
      default: 'staff',
    },
  },
  { timestamps: true, collection: 'staffUsers' },
);

export type StaffUserAttributes = InferSchemaType<typeof staffUserSchema>;
export type StaffUserDocument = HydratedDocument<StaffUserAttributes>;

export const StaffUser = model<StaffUserAttributes>('StaffUser', staffUserSchema);
