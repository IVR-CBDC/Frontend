import { useState } from "react";
import { api } from "@/shared/api/axios";
export default function DocumentsPage() {
  const [file, setFile] = useState<File | null>(null);
  const uploadFile = async () => {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    await api.post("/documents/upload", formData);
  };
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Documents</h1>
      <div className="bg-white p-6 rounded-2xl shadow">
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <button onClick={uploadFile} className="mt-4 bg-blue-600 text-white px-5 py-3 rounded-xl">Upload</button>
      </div>
    </div>
  );
}
