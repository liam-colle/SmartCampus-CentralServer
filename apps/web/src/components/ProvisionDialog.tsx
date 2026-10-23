import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { ErrorText, Field } from "@/components/Field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatFingerprint } from "@/lib/types";
import { useFetch } from "@/lib/useFetch";

/** What the door unit scans. The key travels in the code, out of band, so nobody can swap it on the network. */
export const provisioningLink = (url: string, key: string) => `smartcampus://provision?${new URLSearchParams({ url, key })}`;

/**
 * Shows the QR code a door unit scans on first boot to learn the server address and the key it will
 * pin. The fingerprint is shown too, for the installer who prefers to fetch the key from the
 * terminal and compare.
 */
export function ProvisionDialog({ onClose }: { onClose: () => void }) {
  const key = useFetch<{ publicKey: string; fingerprint: string }>("/server-key");
  // Why editable: the console is often opened on localhost, but a terminal needs an address it can reach.
  const [address, setAddress] = useState(location.origin);
  const [qr, setQr] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  useEffect(() => {
    if (!key.data || !/^https?:\/\/.+/.test(address)) return setQr(null);
    QRCode.toDataURL(provisioningLink(address.replace(/\/+$/, ""), key.data.publicKey), { margin: 2, width: 320, errorCorrectionLevel: "M" })
      .then((url) => (setQr(url), setQrError(null)))
      .catch(() => setQrError("Could not draw the QR code"));
  }, [key.data, address]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Provision a device</DialogTitle>
          <DialogDescription>
            On the terminal, open the Smart Campus app and scan this code. It fills in the server address and key, then asks to be approved here.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field label="Server address devices should use" htmlFor="p-address" hint="Must be reachable from the terminal, for example http://192.168.1.20:3000. Not localhost.">
            <Input id="p-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <ErrorText>{key.error ?? qrError}</ErrorText>
          <div className="flex justify-center">
            {qr ? (
              // The code needs a light background to be readable by a scanner, whatever the theme.
              <img src={qr} alt="QR code with the server address and public key" className="size-60 rounded-lg bg-white" />
            ) : (
              <div className="grid size-60 place-items-center rounded-lg border text-sm text-muted-foreground">{key.loading ? "Loading…" : "Enter a valid address"}</div>
            )}
          </div>
          {key.data && (
            <div className="text-sm">
              <div className="text-muted-foreground">Server key fingerprint, to compare when the terminal fetches the key itself</div>
              <div className="mt-1 break-all font-mono">{formatFingerprint(key.data.fingerprint)}</div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
