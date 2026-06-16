import {
  pgTable, uuid, text, numeric, boolean,
  timestamp, date, integer, unique
} from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  lineUserId:            text('line_user_id').unique().notNull(),
  displayName:           text('display_name'),
  pictureUrl:            text('picture_url'),
  morningSummaryEnabled: boolean('morning_summary_enabled').default(true),
  morningSummaryTime:    text('morning_summary_time').default('08:00'),
  timezone:              text('timezone').default('Asia/Bangkok'),
  createdAt:             timestamp('created_at').defaultNow(),
  updatedAt:             timestamp('updated_at').defaultNow(),
})

export const budgetCategories = pgTable('budget_categories', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  icon:      text('icon').default('📦'),
  color:     text('color').default('#2A5C45'),
  sortOrder: integer('sort_order').default(0),
})

export const budgets = pgTable('budgets', {
  id:         uuid('id').primaryKey().defaultRandom(),
  userId:     uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id').references(() => budgetCategories.id, { onDelete: 'cascade' }),
  amount:     numeric('amount', { precision: 12, scale: 2 }).notNull(),
  month:      text('month').notNull(),
  createdAt:  timestamp('created_at').defaultNow(),
}, t => ({ uniq: unique().on(t.userId, t.categoryId, t.month) }))

export const transactions = pgTable('transactions', {
  id:              uuid('id').primaryKey().defaultRandom(),
  userId:          uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  categoryId:      uuid('category_id').references(() => budgetCategories.id),
  type:            text('type').notNull(),
  amount:          numeric('amount', { precision: 12, scale: 2 }).notNull(),
  description:     text('description'),
  merchantName:    text('merchant_name'),
  transactionDate: date('transaction_date').defaultNow(),
  slipImageUrl:    text('slip_image_url'),
  source:          text('source').default('MANUAL'),
  createdAt:       timestamp('created_at').defaultNow(),
})

export const appointments = pgTable('appointments', {
  id:             uuid('id').primaryKey().defaultRandom(),
  userId:         uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title:          text('title').notNull(),
  location:       text('location'),
  category:       text('category').default('PERSONAL'),
  startAt:        timestamp('start_at').notNull(),
  endAt:          timestamp('end_at'),
  reminderMin:    integer('reminder_min').default(60),
  isReminded:     boolean('is_reminded').default(false),
  gcalEventId:    text('gcal_event_id').unique(),
  gcalCalendarId: text('gcal_calendar_id'),
  sourceUpdated:  text('source_updated').default('MYASSIST'),
  source:         text('source').default('MANUAL'),
  createdAt:      timestamp('created_at').defaultNow(),
})

export const reminders = pgTable('reminders', {
  id:         uuid('id').primaryKey().defaultRandom(),
  userId:     uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  message:    text('message').notNull(),
  remindAt:   timestamp('remind_at').notNull(),
  repeatType: text('repeat_type').default('NONE'),
  isDone:     boolean('is_done').default(false),
  createdAt:  timestamp('created_at').defaultNow(),
})

export const pushLog = pgTable('push_log', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  month:     text('month').notNull(),
  pushCount: integer('push_count').default(0),
  updatedAt: timestamp('updated_at').defaultNow(),
}, t => ({ uniq: unique().on(t.userId, t.month) }))

export const watchedAssets = pgTable('watched_assets', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  symbol:      text('symbol').notNull(),
  displayName: text('display_name').notNull(),
  assetType:   text('asset_type').notNull(),
  currency:    text('currency').default('THB'),
  sortOrder:   integer('sort_order').default(0),
  createdAt:   timestamp('created_at').defaultNow(),
}, t => ({ uniq: unique().on(t.userId, t.symbol) }))

export const priceAlerts = pgTable('price_alerts', {
  id:            uuid('id').primaryKey().defaultRandom(),
  userId:        uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  assetId:       uuid('asset_id').notNull().references(() => watchedAssets.id, { onDelete: 'cascade' }),
  conditionType: text('condition_type').notNull(),
  targetValue:   numeric('target_value', { precision: 18, scale: 4 }).notNull(),
  repeatMode:    text('repeat_mode').default('ONCE'),
  isActive:      boolean('is_active').default(true),
  isTriggered:   boolean('is_triggered').default(false),
  lastTriggered: timestamp('last_triggered'),
  note:          text('note'),
  createdAt:     timestamp('created_at').defaultNow(),
})

export const priceCache = pgTable('price_cache', {
  symbol:    text('symbol').primaryKey(),
  price:     numeric('price', { precision: 18, scale: 4 }).notNull(),
  changePct: numeric('change_pct', { precision: 8, scale: 4 }),
  open:      numeric('open', { precision: 18, scale: 4 }),
  high:      numeric('high', { precision: 18, scale: 4 }),
  low:       numeric('low', { precision: 18, scale: 4 }),
  volume:    numeric('volume', { precision: 20, scale: 0 }),
  currency:  text('currency').default('THB'),
  fetchedAt: timestamp('fetched_at').defaultNow(),
})

export const savingGoals = pgTable('saving_goals', {
  id:            uuid('id').primaryKey().defaultRandom(),
  userId:        uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:          text('name').notNull(),
  icon:          text('icon').default('🎯'),
  targetAmount:  numeric('target_amount', { precision: 14, scale: 2 }).notNull(),
  currentAmount: numeric('current_amount', { precision: 14, scale: 2 }).default('0'),
  deadline:      date('deadline'),
  monthlyTarget: numeric('monthly_target', { precision: 14, scale: 2 }),
  color:         text('color').default('#2A5C45'),
  isCompleted:   boolean('is_completed').default(false),
  createdAt:     timestamp('created_at').defaultNow(),
})

export const goalContributions = pgTable('goal_contributions', {
  id:          uuid('id').primaryKey().defaultRandom(),
  goalId:      uuid('goal_id').notNull().references(() => savingGoals.id, { onDelete: 'cascade' }),
  userId:      uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  amount:      numeric('amount', { precision: 14, scale: 2 }).notNull(),
  note:        text('note'),
  contribDate: date('contrib_date').defaultNow(),
  createdAt:   timestamp('created_at').defaultNow(),
})

export const portfolioPositions = pgTable('portfolio_positions', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  assetId:     uuid('asset_id').references(() => watchedAssets.id),
  symbol:      text('symbol').notNull(),
  displayName: text('display_name').notNull(),
  assetType:   text('asset_type').notNull(),
  quantity:    numeric('quantity', { precision: 18, scale: 6 }).notNull(),
  avgCost:     numeric('avg_cost', { precision: 18, scale: 4 }).notNull(),
  currency:    text('currency').default('THB'),
  createdAt:   timestamp('created_at').defaultNow(),
  updatedAt:   timestamp('updated_at').defaultNow(),
})

export const portfolioTrades = pgTable('portfolio_trades', {
  id:         uuid('id').primaryKey().defaultRandom(),
  positionId: uuid('position_id').notNull().references(() => portfolioPositions.id, { onDelete: 'cascade' }),
  userId:     uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tradeType:  text('trade_type').notNull(),
  quantity:   numeric('quantity', { precision: 18, scale: 6 }).notNull(),
  price:      numeric('price', { precision: 18, scale: 4 }).notNull(),
  fee:        numeric('fee', { precision: 10, scale: 2 }).default('0'),
  tradeDate:  date('trade_date').defaultNow(),
  note:       text('note'),
  createdAt:  timestamp('created_at').defaultNow(),
})

export const googleCalendarTokens = pgTable('google_calendar_tokens', {
  userId:       uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  accessToken:  text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  expiresAt:    timestamp('expires_at').notNull(),
  calendarIds:  text('calendar_ids').array(),
  syncEnabled:  boolean('sync_enabled').default(true),
  lastSynced:   timestamp('last_synced'),
  createdAt:    timestamp('created_at').defaultNow(),
})

export const signalLog = pgTable('signal_log', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  symbol:    text('symbol').notNull(),
  score:     numeric('score', { precision: 4, scale: 2 }),
  overall:   text('overall'),
  timeframe: text('timeframe'),
  sentAt:    timestamp('sent_at').defaultNow(),
})

export const newsCache = pgTable('news_cache', {
  id:        uuid('id').primaryKey().defaultRandom(),
  symbol:    text('symbol').notNull(),
  headline:  text('headline').notNull(),
  summary:   text('summary'),
  source:    text('source'),
  url:       text('url'),
  fetchedAt: timestamp('fetched_at').defaultNow(),
})

export const marketSymbols = pgTable('market_symbols', {
  symbol:       text('symbol').primaryKey(),
  exchange:     text('exchange').notNull(),
  displayName:  text('display_name'),
  yahooSymbol:  text('yahoo_symbol').notNull(),
  sortOrder:    integer('sort_order').notNull().default(0),
})

export const marketAnalysisCache = pgTable('market_analysis_cache', {
  symbol:          text('symbol').primaryKey(),
  displayName:     text('display_name'),
  exchange:        text('exchange'),
  normalizedScore: numeric('normalized_score', { precision: 6, scale: 4 }),
  overall:         text('overall'),
  price:           numeric('price', { precision: 16, scale: 4 }),
  changePct:       numeric('change_pct', { precision: 8, scale: 4 }),
  scannedAt:       timestamp('scanned_at').defaultNow(),
})

export const marketScanState = pgTable('market_scan_state', {
  id:           text('id').primaryKey().default('global'),
  cursorIndex:  integer('cursor_index').notNull().default(0),
  totalSymbols: integer('total_symbols').notNull().default(0),
  lastCycleAt:  timestamp('last_cycle_at'),
  updatedAt:    timestamp('updated_at').defaultNow(),
})
