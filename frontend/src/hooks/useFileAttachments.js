import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

export function useFileAttachments() {
  const { session } = useAuth()
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)

  async function uploadFile(file) {
    setUploading(true)
    const form = new FormData()
    form.append('file', file)

    try {
      const res = await fetch('/upload/resume', {
        method: 'POST',
        body: form,
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      })
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
      const data = await res.json()
      setFiles(prev => [
        ...prev,
        { id: crypto.randomUUID(), name: file.name, text: data.extracted_text },
      ])
    } finally {
      setUploading(false)
    }
  }

  function removeFile(id) {
    setFiles(prev => prev.filter(f => f.id !== id))
  }

  function consumeFiles() {
    const texts = files.map(f => f.text)
    setFiles([])
    return texts
  }

  function clearFiles() {
    setFiles([])
  }

  return { files, uploading, uploadFile, removeFile, consumeFiles, clearFiles }
}
