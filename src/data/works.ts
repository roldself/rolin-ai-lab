import content from './content.json';

export type Work = {
  id: string;
  name: string;
  category: 'Skill' | 'Agent' | 'Product';
  icon: string;
  description: string;
  status: '待整理' | 'Building' | 'Testing' | 'Published' | 'Archived' | 'Idea';
  version?: string;
  date?: string;
  capabilities?: string[];
  technology?: string[];
  links?: { label: string; href: string }[];
  format?: string;
  body?: string;
  cover?: string;
  screenshots?: { src: string; caption: string }[];
};

export const works = content.works as Work[];
export const featured = content.featured;

export const groups = [
  { id: 'skills', title: 'Skills', category: 'Skill', icon: '🧠', caption: '把经验变成可复用的方法。' },
  { id: 'agents', title: 'Agents', category: 'Agent', icon: '🤖', caption: '让方法串起来，让任务持续往前走。' },
  { id: 'products', title: 'Products', category: 'Product', icon: '🧪', caption: '把想法做成可以使用的东西。' }
];
