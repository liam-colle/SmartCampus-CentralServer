import { createHash } from "node:crypto";
import { ulid } from "@smartcampus/protocol";
import { deleteFile, saveFile } from "../infra/gridfs.js";
import { HttpError } from "../lib/errors.js";
import { recordAudit } from "../lib/audit.js";
import { sniffAudio } from "../lib/audioSniff.js";
import { AssetModel } from "../models/asset.js";
import { CommandModel } from "../models/command.js";
import type { PublicUser } from "../models/user.js";

type Actor = Pick<PublicUser, "id" | "name">;

/** Validates an uploaded audio file, stores it in GridFS and records its hash and size. */
export async function storeAudioAsset(data: Buffer, name: string, actor: Actor) {
  if (data.length === 0) throw new HttpError(400, "The file is empty");
  const format = sniffAudio(data);
  if (!format) throw new HttpError(415, "Unsupported audio file. Use WAV, MP3, Ogg, WebM or M4A");

  const assetId = ulid();
  const sha256 = createHash("sha256").update(data).digest("hex");
  const gridFsId = await saveFile(`${assetId}.${format.extension}`, data);
  const asset = await AssetModel.create({
    assetId,
    name,
    mime: format.mime,
    extension: format.extension,
    size: data.length,
    sha256,
    gridFsId,
    createdByName: actor.name,
  });
  await recordAudit(actor, "asset.upload", { type: "asset", id: assetId }, { name, size: data.length });
  return asset;
}

export async function deleteAsset(assetId: string, actor: Actor): Promise<void> {
  const asset = await AssetModel.findOneAndDelete({ assetId });
  if (!asset) throw new HttpError(404, "Asset not found");
  await deleteFile(asset.gridFsId);
  await recordAudit(actor, "asset.delete", { type: "asset", id: assetId }, { name: asset.name });
}

/**
 * Least privilege for downloads: a device may only fetch an asset it was told to play. Without this,
 * any enrolled device could read every recording stored on the server.
 */
export const wasAssetSentTo = (deviceId: string, assetId: string) =>
  CommandModel.exists({ deviceId, type: "audio.play", "payload.assetId": assetId });
