"use client";

import { useCallback, useState } from "react";

export type UploadedAsset = {
  id: string;
  name: string;
  kind: string;
  sizeBytes?: number;
  thumbKey?: string | null;
};
export type UploadItem = {
  key: string;
  name: string;
  progress: number;
  error?: string;
  asset?: UploadedAsset;
};

/** Envoie un fichier brut avec suivi de progression. */
export function uploadFile(
  url: string,
  file: Blob,
  contentType: string,
  onProgress: (p: number) => void,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(url.includes("/takes") ? "POST" : "PUT", url);
    xhr.setRequestHeader("Content-Type", contentType || "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: { error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* réponse vide */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body.error ?? "Import impossible."));
    };
    xhr.onerror = () => reject(new Error("Connexion interrompue."));
    xhr.send(file);
  });
}

export function useUpload(onDone?: (asset: UploadedAsset) => void) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const upload = useCallback(
    async (files: FileList | File[], kind?: string) => {
      for (const file of Array.from(files)) {
        const key = `${file.name}-${file.size}-${Math.random()}`;
        setItems((prev) => [...prev, { key, name: file.name, progress: 0 }]);
        const params = new URLSearchParams({ name: file.name });
        if (kind) params.set("kind", kind);
        try {
          const res = (await uploadFile(`/api/assets?${params}`, file, file.type, (p) =>
            setItems((prev) => prev.map((i) => (i.key === key ? { ...i, progress: p } : i))),
          )) as { asset: UploadedAsset };
          setItems((prev) => prev.map((i) => (i.key === key ? { ...i, progress: 1, asset: res.asset } : i)));
          onDone?.(res.asset);
        } catch (err) {
          setItems((prev) =>
            prev.map((i) =>
              i.key === key ? { ...i, error: err instanceof Error ? err.message : "Erreur" } : i,
            ),
          );
        }
      }
    },
    [onDone],
  );
  const remove = (key: string) => setItems((prev) => prev.filter((i) => i.key !== key));
  return { items, upload, remove };
}
