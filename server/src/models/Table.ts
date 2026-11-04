import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const tableSchema = new Schema(
  {
    label: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    capacity: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: 'capacity must be a whole number.',
      },
    },
    active: {
      type: Boolean,
      required: true,
      default: true,
    },
  },
  { timestamps: true, collection: 'tables' },
);

export type TableAttributes = InferSchemaType<typeof tableSchema>;
export type TableDocument = HydratedDocument<TableAttributes>;

export const Table = model<TableAttributes>('Table', tableSchema);
