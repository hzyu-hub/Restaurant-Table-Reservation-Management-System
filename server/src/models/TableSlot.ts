import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

/**
 * One row per occupied 30 minute slot of one table.
 *
 * The UNIQUE compound index on `{ tableId, slotStart }` is the concurrency
 * guard for FR4: two racing requests for the same table+time cannot both
 * insert, no matter how many app servers there are. MongoDB enforces it, not
 * application code. DO NOT REMOVE THIS INDEX — removing it silently reopens
 * the double-booking race that `tests/concurrency.test.ts` covers.
 *
 * Rows are written before the `reservations` document exists, so they carry a
 * pre-generated `reservationId` used for cleanup on partial insert.
 */
const tableSlotSchema = new Schema(
  {
    tableId: {
      type: Schema.Types.ObjectId,
      ref: 'Table',
      required: true,
    },
    slotStart: {
      type: Date,
      required: true,
    },
    reservationId: {
      type: Schema.Types.ObjectId,
      ref: 'Reservation',
      required: true,
    },
  },
  { timestamps: true, collection: 'tableSlots' },
);

tableSlotSchema.index({ tableId: 1, slotStart: 1 }, { unique: true });
tableSlotSchema.index({ reservationId: 1 });

export type TableSlotAttributes = InferSchemaType<typeof tableSlotSchema>;
export type TableSlotDocument = HydratedDocument<TableSlotAttributes>;

export const TableSlot = model<TableSlotAttributes>('TableSlot', tableSlotSchema);
