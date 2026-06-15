import { Router } from 'express'
import multer from 'multer'
import { processSlipOCR } from '../services/ocr.service'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

router.post('/slip', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: true, code: 'VALIDATION_ERROR', message: 'No file uploaded' })
  }
  try {
    const result = await processSlipOCR(req.user.id, req.file.buffer, req.file.mimetype)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: true, code: 'INTERNAL', message: 'OCR failed' })
  }
})

export default router
