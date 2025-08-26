/**
 * ===============================================
 * Social Media Types - أنواع وسائل التواصل الاجتماعي
 * Unified types for social media interactions across the platform
 * ===============================================
 */

import { z } from 'zod';

/**
 * أنواع تفاعلات الستوري
 * Story interaction types
 */
export const STORY_INTERACTION_TYPES = [
  'story_reply',
  'story_mention', 
  'story_reaction',
  'story_view'
] as const;

export type StoryInteractionType = typeof STORY_INTERACTION_TYPES[number];

/**
 * Zod schema للتحقق من نوع تفاعل الستوري
 * Zod schema for story interaction type validation
 */
export const StoryInteractionTypeSchema = z.enum(STORY_INTERACTION_TYPES);

/**
 * تفاعل الستوري - يستخدم في Instagram Stories Manager
 * Story interaction - used in Instagram Stories Manager
 */
export interface StoryInteraction {
  id: string;
  type: StoryInteractionType;
  storyId: string;
  userId: string;
  username?: string;
  content?: string;
  mediaUrl?: string;
  timestamp: Date | string;
  text?: string;
  emoji?: string;
  payload?: Record<string, unknown>;
  metadata?: {
    reactionType?: string;
    storyType?: 'photo' | 'video' | 'reel';
    isPrivate?: boolean;
  };
}

/**
 * Zod schema للتحقق من تفاعل الستوري
 * Zod schema for story interaction validation
 */
export const StoryInteractionSchema = z.object({
  id: z.string(),
  type: StoryInteractionTypeSchema,
  storyId: z.string(),
  userId: z.string(),
  username: z.string().optional(),
  content: z.string().optional(),
  mediaUrl: z.string().url().optional(),
  timestamp: z.union([z.date(), z.string()]),
  text: z.string().optional(),
  emoji: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
  metadata: z.object({
    reactionType: z.string().optional(),
    storyType: z.enum(['photo', 'video', 'reel']).optional(),
    isPrivate: z.boolean().optional()
  }).optional()
});

/**
 * تفاعل التعليق - يستخدم في Instagram Comments Manager
 * Comment interaction - used in Instagram Comments Manager
 */
export interface CommentInteraction {
  id: string;
  postId: string;
  userId: string;
  username: string;
  content: string;
  isReply: boolean; // إلزامية لضمان التوافق مع الـ manager
  timestamp: Date | string;
  sentiment?: 'positive' | 'neutral' | 'negative';
  sentimentScore?: number; // score للتحليل
  metadata?: {
    isInfluencerComment?: boolean;
    [key: string]: unknown;
  };
}

/**
 * Zod schema للتحقق من تفاعل التعليق
 * Zod schema for comment interaction validation
 */
export const CommentInteractionSchema = z.object({
  id: z.string(),
  postId: z.string(),
  userId: z.string(),
  username: z.string(),
  content: z.string(),
  isReply: z.boolean(),
  timestamp: z.union([z.date(), z.string()]),
  sentiment: z.enum(['positive', 'neutral', 'negative']).optional(),
  sentimentScore: z.number().min(-1).max(1).optional(),
  metadata: z.object({
    isInfluencerComment: z.boolean().optional()
  }).and(z.record(z.unknown())).optional()
});

/**
 * أنواع المحتوى الإعلامي
 * Media content types
 */
export const MEDIA_CONTENT_TYPES = [
  'image',
  'video', 
  'document',
  'audio',
  'sticker',
  'gif'
] as const;

export type MediaContentType = typeof MEDIA_CONTENT_TYPES[number];

/**
 * حالات رفع المحتوى الإعلامي
 * Media upload status types
 */
export const MEDIA_UPLOAD_STATUSES = [
  'pending',
  'uploaded',
  'failed'
] as const;

export type MediaUploadStatus = typeof MEDIA_UPLOAD_STATUSES[number];

/**
 * المحتوى الإعلامي - يستخدم في Instagram Media Manager
 * Media content - used in Instagram Media Manager
 */
export interface MediaContent {
  id: string;
  type: MediaContentType;
  url: string;
  uploadStatus: MediaUploadStatus;
  createdAt: Date;
  caption?: string;
  hashtags?: string[];
  metadata?: {
    duration?: number;
    fileSize?: number;
    dimensions?: {
      width: number;
      height: number;
    };
    format?: string;
    originalFileName?: string;
    aiAnalysis?: {
      description?: string;
      objects?: string[];
      colors?: string[];
      text?: string;
      sentiment?: 'positive' | 'neutral' | 'negative';
      isProductImage?: boolean;
      suggestedTags?: string[];
    };
  };
}

/**
 * Zod schema للتحقق من المحتوى الإعلامي
 * Zod schema for media content validation
 */
export const MediaContentSchema = z.object({
  id: z.string(),
  type: z.enum(MEDIA_CONTENT_TYPES),
  url: z.string().url(),
  uploadStatus: z.enum(MEDIA_UPLOAD_STATUSES),
  createdAt: z.date(),
  caption: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  metadata: z.object({
    duration: z.number().positive().optional(),
    fileSize: z.number().positive().optional(),
    dimensions: z.object({
      width: z.number().positive(),
      height: z.number().positive()
    }).optional(),
    format: z.string().optional(),
    originalFileName: z.string().optional(),
    aiAnalysis: z.object({
      description: z.string().optional(),
      objects: z.array(z.string()).optional(),
      colors: z.array(z.string()).optional(),
      text: z.string().optional(),
      sentiment: z.enum(['positive', 'neutral', 'negative']).optional(),
      isProductImage: z.boolean().optional(),
      suggestedTags: z.array(z.string()).optional()
    }).optional()
  }).optional()
});

/**
 * دوال مساعدة للتحقق من صحة البيانات
 * Helper functions for data validation
 */

/**
 * دالة للتحقق من صحة نوع تفاعل الستوري
 * Function to validate story interaction type
 */
export function isValidStoryInteractionType(type: string): type is StoryInteractionType {
  return StoryInteractionTypeSchema.safeParse(type).success;
}

/**
 * دالة للتحقق من صحة نوع المحتوى الإعلامي
 * Function to validate media content type
 */
export function isValidMediaContentType(type: string): type is MediaContentType {
  return z.enum(MEDIA_CONTENT_TYPES).safeParse(type).success;
}

/**
 * دالة للتحقق من صحة حالة رفع المحتوى
 * Function to validate media upload status
 */
export function isValidMediaUploadStatus(status: string): status is MediaUploadStatus {
  return z.enum(MEDIA_UPLOAD_STATUSES).safeParse(status).success;
}
