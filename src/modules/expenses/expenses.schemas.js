import { z } from 'zod'

const amountKobo = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
// "on" chips on the I spent page
export const CATEGORIES = ['food', 'transport', 'data', 'eating_out', 'other']
const category = z.enum(CATEGORIES)

export const createExpenseSchema = z.object({
  allocationId: z.string().min(1), // which bucket (Needs, Wants...) this came out of
  amountKobo,
  note: z.string().trim().max(140).optional(),
  category: category.optional(),
  spentAt: z.coerce.date().optional(),
})

export const updateExpenseSchema = z
  .object({
    allocationId: z.string().min(1).optional(),
    amountKobo: amountKobo.optional(),
    note: z.string().trim().max(140).nullable().optional(),
    category: category.nullable().optional(),
    spentAt: z.coerce.date().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, 'Send at least one field to update')

export const listExpensesQuery = z.object({
  allocationId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().optional(),
})
