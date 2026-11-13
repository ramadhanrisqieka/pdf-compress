import { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';

interface Props {
  accept: string;
  multiple?: boolean;
  label: string;
  onFiles: (files: File[]) => void;
}

export default function Dropzone({ accept, multiple, label, onFiles }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const handle = (list: FileList | null) => {
    if (!list) return;
    const exts = accept.split(',').map((a) => a.trim());
    const files = Array.from(list).filter((f) =>
      exts.some((a) => (a.startsWith('.') ? f.name.toLowerCase().endsWith(a) : f.type.match(a.replace('*', '.*')))),
    );
    if (files.length) onFiles(files);
  };

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files); }}
      className={`cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition ${
        over ? 'border-red-600 bg-red-50' : 'border-slate-300 bg-white hover:border-red-400'
      }`}
    >
      <UploadCloud className="mx-auto mb-3 h-10 w-10 text-red-600" />
      <p className="font-semibold">{label}</p>
      <p className="text-sm text-slate-500">atau klik untuk memilih file</p>
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => { handle(e.target.files); e.target.value = ''; }}
      />
    </div>
  );
}
