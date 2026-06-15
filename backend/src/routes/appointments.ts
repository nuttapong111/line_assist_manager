import { Router } from 'express'
import * as appointment from '../services/appointment.service'
import { verifyOwner } from '../middleware/ownership'

const router = Router()

router.get('/today', async (req, res) => {
  const appts = await appointment.getTodayAppointments(req.user.id)
  res.json(appts)
})

router.get('/', async (req, res) => {
  const from = req.query.from as string
  const to = req.query.to as string
  const appts = await appointment.getAppointmentsRange(req.user.id, from, to)
  res.json(appts)
})

router.post('/', async (req, res) => {
  const appt = await appointment.createAppointment(req.user.id, req.body)
  res.json(appt)
})

router.put('/:id', async (req, res) => {
  if (!await verifyOwner('appointments', req.params.id, req.user.id)) {
    return res.status(403).json({ error: true, code: 'FORBIDDEN', message: 'Not owner' })
  }
  const appt = await appointment.updateAppointment(req.user.id, req.params.id, req.body)
  res.json(appt)
})

router.delete('/:id', async (req, res) => {
  if (!await verifyOwner('appointments', req.params.id, req.user.id)) {
    return res.status(403).json({ error: true, code: 'FORBIDDEN', message: 'Not owner' })
  }
  await appointment.deleteAppointment(req.user.id, req.params.id)
  res.json({ success: true })
})

export default router
