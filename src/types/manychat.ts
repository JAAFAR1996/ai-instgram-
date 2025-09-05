import { z } from 'zod';

// Minimal image payload allowed to cross boundaries
export const MCImage = z.object({ url: z.string().url() });

// Minimal event shape for ManyChat webhook after sanitization
export const MCEvent = z.object({
  merchantId: z.string().uuid(),
  customerId: z.string().min(1),
  username: z.string().min(1),
  text: z.string().default(''),
  images: z.array(MCImage).default([]),
});

export type MCEvent = z.infer<typeof MCEvent>;

