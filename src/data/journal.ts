import content from './content.json';

export type Block = { type: 'paragraph' | 'heading' | 'quote'; text: string } | { type: 'image'; src: string; caption: string };
export type Article = { id: string; title: string; summary: string; date: string; status: 'Draft' | 'Published'; cover?: string; blocks: Block[] };
export type Profile = { name?: string; bio?: string; email?: string; wechat?: string; wechatQr?: string; xiaohongshu?: string; xiaohongshuUrl?: string; douyin?: string; douyinUrl?: string };
const journal = content as typeof content & { articles?: Article[]; profile?: Profile };
export const articles = (journal.articles || []).filter(article => article.status === 'Published').sort((a, b) => b.date.localeCompare(a.date));
export const profile: Profile = journal.profile || {};
