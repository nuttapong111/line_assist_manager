import { scanSlip } from './nlp.service'

export async function processSlipOCR(userId: string, buffer: Buffer, mimetype: string) {
  return scanSlip(userId, buffer, mimetype)
}
