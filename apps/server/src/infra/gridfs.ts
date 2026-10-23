import { Readable } from "node:stream";
import mongoose, { type Types } from "mongoose";

type ObjectId = Types.ObjectId;

const BUCKET_NAME = "assets";

function bucket() {
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB is not connected");
  return new mongoose.mongo.GridFSBucket(db, { bucketName: BUCKET_NAME });
}

/** Stores a buffer and returns the GridFS file id. */
export function saveFile(filename: string, data: Buffer): Promise<ObjectId> {
  return new Promise((resolve, reject) => {
    const upload = bucket().openUploadStream(filename);
    upload.on("error", reject);
    upload.on("finish", () => resolve(upload.id));
    Readable.from(data).pipe(upload);
  });
}

export const openFile = (id: ObjectId) => bucket().openDownloadStream(id);

export const deleteFile = (id: ObjectId) => bucket().delete(id);
