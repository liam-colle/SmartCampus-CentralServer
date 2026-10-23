import { verifyRequest } from "@smartcampus/handshake";
import express, { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { config } from "../config.js";
import { deleteAsset, storeAudioAsset, wasAssetSentTo } from "../domain/assets.js";
import { activePublicKey } from "../domain/devices.js";
import { openFile } from "../infra/gridfs.js";
import { HttpError } from "../lib/errors.js";
import { AssetModel, assetDto } from "../models/asset.js";

export const assetsRouter = Router();

/** The console uploads with a raw body; the real check is the content sniffing in storeAudioAsset. */
const rawUpload = express.raw({ type: () => true, limit: `${config.MAX_AUDIO_MB}mb` });

const downloadLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many downloads, try again later" },
});

const sendAsset = async (asset: InstanceType<typeof AssetModel>, res: express.Response) => {
  res.setHeader("Content-Type", asset.mime);
  res.setHeader("Content-Length", String(asset.size));
  res.setHeader("X-Content-SHA256", asset.sha256);
  // The id is a ULID and the content never changes, so devices and browsers may keep it.
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.setHeader("Content-Disposition", `inline; filename="${asset.assetId}.${asset.extension}"`);
  openFile(asset.gridFsId).on("error", () => res.destroy()).pipe(res);
};

/**
 * Device download. The request is signed with the device key (method, path, timestamp), so a
 * stolen URL is useless. Every failure answers the same 401/404 to reveal nothing.
 */
assetsRouter.get("/:id/download", downloadLimiter, async (req, res) => {
  const deviceId = req.get("x-device-id") ?? "";
  const publicKey = deviceId ? await activePublicKey(deviceId) : null;
  const path = req.originalUrl.split("?")[0]!;
  const signed = publicKey
    ? verifyRequest(publicKey, {
        method: req.method,
        path,
        timestamp: req.get("x-timestamp") ?? "",
        signature: req.get("x-signature") ?? "",
      })
    : false;
  if (!signed) throw new HttpError(401, "Unauthorized");

  const asset = await AssetModel.findOne({ assetId: req.params.id });
  if (!asset || !(await wasAssetSentTo(deviceId, asset.assetId))) throw new HttpError(404, "Not found");
  await sendAsset(asset, res);
});

/** Console: everything below needs a signed-in user. */
assetsRouter.use(requireAuth);

const canWrite = requireRole("admin", "operator");

assetsRouter.get("/", async (_req, res) => {
  res.json({ items: (await AssetModel.find().sort({ createdAt: -1 }).limit(200)).map(assetDto) });
});

assetsRouter.post("/", canWrite, rawUpload, async (req, res) => {
  const name = typeof req.query.name === "string" ? req.query.name.trim().slice(0, 100) : "";
  if (!name) throw new HttpError(400, "name is required");
  if (!Buffer.isBuffer(req.body)) throw new HttpError(400, "Send the audio file as the request body");
  const asset = await storeAudioAsset(req.body, name, req.user!);
  res.status(201).json(assetDto(asset));
});

/** Preview in the console, with the user's session. */
assetsRouter.get("/:id/file", async (req, res) => {
  const asset = await AssetModel.findOne({ assetId: req.params.id });
  if (!asset) throw new HttpError(404, "Asset not found");
  await sendAsset(asset, res);
});

assetsRouter.delete("/:id", canWrite, async (req, res) => {
  await deleteAsset(String(req.params.id), req.user!);
  res.status(204).end();
});
