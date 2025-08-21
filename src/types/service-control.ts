import { z } from 'zod';

export const ToggleServiceSchema = z.object({
  merchantId: z.string().uuid('معرف التاجر يجب أن يكون UUID صالح'),
  service: z.enum(['instagram', 'ai_processing', 'auto_reply', 'story_response', 'comment_response', 'dm_processing']),
  enabled: z.boolean(),
  reason: z.string().optional(),
  toggledBy: z.string().optional()
});

export type ToggleService = z.infer<typeof ToggleServiceSchema>;