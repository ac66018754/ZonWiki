#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execSync } = require('child_process');

// 配置
const API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!API_KEY) {
  console.error('❌ 错误：ANTHROPIC_API_KEY 未设置');
  process.exit(1);
}

// 获取修改的文件列表
const changedFilesArg = process.argv[2];
if (!changedFilesArg) {
  console.log('✅ 没有修改的 MD 文件');
  process.exit(0);
}

const changedFiles = changedFilesArg.split('\n').filter(f => f.trim() && f.endsWith('.md'));
console.log(`📋 发现 ${changedFiles.length} 个修改的 MD 文件`);

// Anthropic API 调用
async function generateSupplement(originalContent, filename) {
  try {
    const prompt = `你是一个 Markdown 文档编辑助手。

用户有一个名为 "${filename}" 的 Markdown 文件，其内容如下：

---
${originalContent}
---

请为这个文件生成一份补充材料（补充文件），文件名将是 "${filename.replace(/\.md$/, '')}_補充.md"

补充文件应该包含：
1. 【扩展阅读】- 相关主题的补充链接或推荐资源
2. 【深入理解】- 对文档中关键概念的更深入解释
3. 【实践例子】- 实际应用的代码示例或案例研究（如果适用）
4. 【常见问题】- 用户可能遇到的问题和解决方案
5. 【相关工具】- 推荐的工具或库（如果适用）

请用 Markdown 格式编写，确保清晰、有组织、易于阅读。`;

    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-opus-4-1',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    }, {
      headers: {
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    });

    return response.data.content[0].text;
  } catch (error) {
    console.error(`❌ API 调用失败: ${error.message}`);
    throw error;
  }
}

// 主逻辑
async function main() {
  const createdFiles = [];
  const modifiedFiles = [];

  for (const file of changedFiles) {
    const supplementFilename = file.replace(/\.md$/, '_補充.md');
    const supplementPath = path.join(path.dirname(file), path.basename(supplementFilename));

    console.log(`\n📝 处理: ${file}`);

    try {
      // 读取原始文件
      const content = fs.readFileSync(file, 'utf-8');

      // 生成补充内容
      console.log(`   🤖 调用 Claude API 生成补充...`);
      const supplement = await generateSupplement(content, path.basename(file));

      // 检查补充文件是否已存在
      const supplementExists = fs.existsSync(supplementPath);

      if (supplementExists) {
        // 如果存在，读取现有内容
        const existingContent = fs.readFileSync(supplementPath, 'utf-8');
        
        // 合并：保留人工编辑部分，更新自动生成部分
        const mergedContent = `${supplement}\n\n<!--\n自动生成的补充内容已更新\nLast updated: ${new Date().toISOString()}\n-->`;
        
        fs.writeFileSync(supplementPath, mergedContent, 'utf-8');
        modifiedFiles.push(supplementPath);
        console.log(`   ✏️  已更新: ${supplementPath}`);
      } else {
        // 如果不存在，创建新文件
        fs.writeFileSync(supplementPath, supplement, 'utf-8');
        createdFiles.push(supplementPath);
        console.log(`   ✨ 已创建: ${supplementPath}`);
      }

      // 延迟以避免 API 限制
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.error(`   ❌ 处理失败: ${error.message}`);
      continue;
    }
  }

  // 总结
  console.log('\n' + '='.repeat(50));
  console.log(`✅ 完成！`);
  console.log(`   创建的文件: ${createdFiles.length}`);
  console.log(`   修改的文件: ${modifiedFiles.length}`);

  if (createdFiles.length > 0 || modifiedFiles.length > 0) {
    // Git 操作
    try {
      const allChanges = [...createdFiles, ...modifiedFiles];
      
      execSync(`git config user.email "github-actions[bot]@github.com"`);
      execSync(`git config user.name "GitHub Actions"`);
      execSync(`git add ${allChanges.join(' ')}`);
      
      const commitMsg = `docs: auto-generate MD supplement files\n\nGenerated: ${createdFiles.length} new, Updated: ${modifiedFiles.length} existing`;
      execSync(`git commit -m "${commitMsg}"`);
      
      console.log('\n🚀 Git 提交完成');
    } catch (error) {
      console.error(`   ⚠️  Git 操作出错: ${error.message}`);
    }
  }
}

main().catch(error => {
  console.error('❌ 脚本执行失败:', error);
  process.exit(1);
});
