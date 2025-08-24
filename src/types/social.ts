// أنواع موحدة تُستخدم عبر stories manager/testing orchestrator/comments
export type StoryInteractionType =
  | 'story_reply'
  | 'story_mention'
  | 'story_reaction'
  | 'story_view';

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

export interface CommentInteraction {
  id: string;
  postId: string;
  userId: string;
  username: string;
  content: string;
  isReply: boolean; // جعلها إلزامية لضمان التوافق مع الـ manager
  timestamp: Date | string;
  sentiment?: 'positive' | 'neutral' | 'negative';
  sentimentScore?: number; // إضافة score للتحليل
  metadata?: {
    isInfluencerComment?: boolean;
    [key: string]: unknown;
  };
}

export interface MediaContent {
  id: string;
  type: 'image' | 'video' | 'document' | 'audio' | 'sticker' | 'gif';
  url: string;
  uploadStatus: 'pending' | 'uploaded' | 'failed';
  createdAt: Date;
  caption?: string;
  hashtags?: string[];
}
