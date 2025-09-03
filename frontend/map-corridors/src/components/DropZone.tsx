import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'

export function DropZone(props: {
  onDropFiles: (files: File[]) => void | Promise<void>
  accept?: { [mime: string]: string[] }
}) {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    props.onDropFiles(acceptedFiles)
  }, [props])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: props.accept })

  return (
    <div
      {...getRootProps()}
      style={{
        border: '2px dashed #cbd5e1',
        borderRadius: 8,
        padding: 12,
        minWidth: 280,
        textAlign: 'center',
        cursor: 'pointer',
      }}
      title="Drop a KML file here"
    >
      <input {...getInputProps()} />
      {isDragActive ? 'Drop the file here…' : 'Drop KML here or click to select'}
    </div>
  )
}


