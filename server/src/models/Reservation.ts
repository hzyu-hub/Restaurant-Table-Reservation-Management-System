import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { RESERVATION_STATUSES, type ReservationStatus } from '../config/booking.js';

const reservationSchema = new Schema(
  {
    reference: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    customerName: {
      type: String,
      required: true,
      trim: true,
    },
    customerEmail: {
      type: String,
      required: false,
      trim: true,
      lowercase: true,
    },
    customerPhone: {
      type: String,
      required: true,
      trim: true,
    },
    partySize: {
      type: Number,
      required: true,
      min: 1,
    },
    tableId: {
      type: Schema.Types.ObjectId,
      ref: 'Table',
      required: true,
      index: true,
    },
    startTime: {
      type: Date,
      required: true,
      index: true,
    },
    endTime: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      required: true,
      enum: RESERVATION_STATUSES,
      default: 'CONFIRMED' satisfies ReservationStatus,
      index: true,
    },
  },
  { timestamps: true, collection: 'reservations' },
);

export type ReservationAttributes = InferSchemaType<typeof reservationSchema>;
export type ReservationDocument = HydratedDocument<ReservationAttributes>;

export const Reservation = model<ReservationAttributes>(
  'Reservation',
  reservationSchema,
);
