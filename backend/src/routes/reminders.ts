import { Router } from 'express'
import * as appointment from '../services/appointment.service'
import { verifyOwner } from '../middleware/ownership'

const router = Router()

router.get('/', async (req, res) => {
  const reminders = await appointment.getUpcomingReminders(req.user.id)
  res.json(reminders)
})

router.post('/', async (req, res) => {
  const reminder = await appointment.createReminder(req.user.id, req.body)
  res.json(reminder)
})

router.patch('/:id/done', async (req, res) => {
  if (!await verifyOwner('reminders', req.params.id, req.user.id)) {
    return res.status(403).json({ error: true, code: 'FORBIDDEN', message: 'Not owner' })
  }
  const reminder = await appointment.markReminderDone(req.user.id, req.params.id)
  res.json(reminder)
})

router.delete('/:id', async (req, res) => {
  if (!await verifyOwner('reminders', req.params.id, req.user.id)) {
    return res.status(403).json({ error: true, code: 'FORBIDDEN', message: 'Not owner' })
  }
  await appointment.deleteReminder(req.user.id, req.params.id)
  res.json({ success: true })
})

export default router
