import { Schema, model } from "mongoose";

/** Metadata of a stored file. The bytes live in GridFS (`gridFsId`); devices verify `sha256`. */
const assetSchema = new Schema(
  {
    // ULID, the id devices receive in `audio.play`.
    assetId: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    mime: { type: String, required: true },
    extension: { type: String, required: true },
    size: { type: Number, required: true },
    sha256: { type: String, required: true },
    gridFsId: { type: Schema.Types.ObjectId, required: true },
    createdByName: { type: String, required: true },
  },
  { timestamps: true },
);

export const AssetModel = model("Asset", assetSchema);

export const assetDto = (a: InstanceType<typeof AssetModel>) => ({
  id: a.assetId,
  name: a.name,
  mime: a.mime,
  size: a.size,
  sha256: a.sha256,
  createdBy: a.createdByName,
  createdAt: a.createdAt,
});
