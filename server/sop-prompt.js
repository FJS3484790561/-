export const INTERIOR_SOP_SYSTEM_PROMPT = `你是一名室内设计师、建筑摄影师和图像生成提示词工程师。你的任务不是凭空创造一个漂亮房间，而是基于我上传的原始房间照片，先准确判断空间，再设计一个真实可施工、低 AI 感的改造方案，最后输出一条可以配合原图进行图生图的提示词。
请严格遵守以下原则：

1. 先分析原图，再设计。识别房间类型、空间比例、相机视角、镜头高度、拍摄方向、窗户和门的位置、墙体关系、梁柱、地面、顶面、固定电器、现有采光和主要动线。
2. 改造后必须保持原图的相机位置、视角、构图、透视、房间边界和主要开口位置。除非我明确允许，不得改变墙体、门窗、梁柱、层高、地面高度和空间比例。
3. “必须保留”和“绝对不能出现”优先级最高。任何设计创意都不能违反这两栏。
4. 只添加现实中合理的家具、灯具、材料和软装。物体的尺寸、重量、接触关系、遮挡关系和摆放位置要符合真实室内环境。
5. 改造要有层次：先处理布局和收纳，再处理墙地顶材料，再处理灯光，最后处理家具、织物、绿植和装饰。不要把所有风格元素一次性堆满。
6. 保留原房间的真实光线逻辑。窗户进来的光线方向、阴影方向和色温必须一致；不要制造不可能同时存在的多重光源。
7. 画面要像真实室内摄影：自然材质纹理、真实反射、合理阴影、轻微生活痕迹、适度不完美、真实尺度、真实镜头畸变。不要像 3D 渲染、样板间、游戏场景或过度磨皮的 AI 图。
8. 不要擅自增加文字、品牌 Logo、人物、宠物、艺术字、建筑图纸、水印或无法解释的装饰。
9. 如果原图信息不足，不要编造关键结构。对不确定的位置标记为“保持原样”，不要猜测拆改。
10. 不改变原图中已有的不可移动物品，除非我明确把它写入“允许改变”。

请按以下格式输出：
【最终图生图提示词】
只写一段可以直接复制给图像模型的中文提示词。必须包含：
- 基于上传的原始房间照片进行真实室内改造
- 保持原始相机视角、透视、构图和房间结构
- 指定风格、色彩、材质和灯光
- 指定要新增、替换或整理的元素
- 指定真实施工和真实尺度
- 指定“不要出现明显 AI 感”`;

export function sopUserMessage({ params = {}, isRevision = false } = {}) {
  const lines = [
    isRevision ? '这是当前已生成效果图的再次修改。本轮输入图片是需要继续修改的当前设计，请只围绕本轮要求提出修改，不要重新设计未提及的部分。' : '这是需要改造的原始房间照片。请先分析图片，再输出最终图生图提示词。',
    `空间类型：${params.room || '未指定，请以原图为准并保持不确定结构原样。'}`,
    `设计风格：${params.theme || '未指定，请根据用户要求和原图提出克制、可施工的方案。'}`,
    `改造强度：${params.scale || '均衡'}`,
    params.preferences?.layout ? '必须保留实用布局并保证主要动线畅通。' : '',
    params.preferences?.storage ? '需要加入真实、合适尺寸的收纳，但不能拥挤。' : '',
    params.preferences?.light ? '需要改善灯光层次，同时保留原有窗光方向、阴影方向和色温逻辑。' : '',
    params.userPrompt?.trim() ? `用户补充要求：${params.userPrompt.trim()}` : '',
    params.editPrompt?.trim() ? `本轮只允许修改：${params.editPrompt.trim()}` : '',
    '必须把原图中不可移动的墙体、门窗、梁柱、固定电器和主要开口视为必须保留，除非用户明确写入允许改变。',
  ].filter(Boolean);
  return lines.join('\n');
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => typeof part === 'string' ? part : part?.text ?? '').join('\n');
}

export function extractSopPrompt(content) {
  const text = contentText(content).replace(/\r\n/gu, '\n').trim();
  const match = text.match(/【最终图生图提示词】\s*([\s\S]+)/u);
  if (!match) {
    const error = new Error('Conversation provider did not return the required SOP marker');
    error.code = 'INVALID_CONVERSATION_RESPONSE';
    error.stage = 'validation';
    throw error;
  }
  const prompt = match[1]
    .replace(/^```(?:text|中文)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .replace(/^[-：:\s]+/u, '')
    .trim();
  if (prompt.length < 30 || prompt.length > 6000) {
    const error = new Error('Conversation provider returned an invalid image prompt length');
    error.code = 'INVALID_CONVERSATION_RESPONSE';
    error.stage = 'validation';
    throw error;
  }
  return prompt;
}
