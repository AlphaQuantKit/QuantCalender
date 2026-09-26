// Keep newly introduced interface strings from silently remaining Chinese.
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'vue/compiler-sfc'
import ts from 'typescript'
import { expect, it } from 'vitest'
import { en } from '../src/locales/en'

it('provides English messages for Chinese UI literals and preserves interpolation slots', () => {
  const missing = new Set<string>()
  function inspect(source: string) {
    const ast = ts.createSourceFile('coverage.ts', source, ts.ScriptTarget.Latest, true)
    function walk(node: ts.Node) {
      let key = ''
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) key = node.text
      if (ts.isTemplateExpression(node)) key = node.head.text + node.templateSpans.map((span,index)=>`{${index}}${span.literal.text}`).join('')
      // Weekday prefix is composed with 日/一/... and translated as a whole.
      if (/[\u3400-\u9fff]/.test(key) && key !== '周' && !en[key]) missing.add(key)
      ts.forEachChild(node,walk)
    }
    walk(ast)
  }
  for (const filename of readdirSync(resolve('src'), {recursive:true}).filter(file=>String(file).endsWith('.vue'))) {
    const {descriptor}=parse(readFileSync(resolve('src', String(filename)),'utf8'))
    if(descriptor.scriptSetup) inspect(descriptor.scriptSetup.content)
    function template(node: any) {
      if (node.type===2 && /[\u3400-\u9fff]/.test(node.content) && !(String(filename).endsWith('LanguageSelector.vue') && node.content==='中文')) missing.add(`Untranslated text: ${node.content}`)
      if(node.type===5)inspect(node.content.content)
      for(const prop of node.props||[]) {
        if(prop.exp)inspect(prop.exp.content)
        if(prop.type===6 && ['title','aria-label','placeholder','submit-label'].includes(prop.name) && /[\u3400-\u9fff]/.test(prop.value?.content||'')) missing.add(`Untranslated attribute: ${prop.value.content}`)
      }
      for(const child of node.children||[])template(child)
    }
    template(descriptor.template!.ast)
  }
  expect([...missing]).toEqual([])
  for(const [source,translated] of Object.entries(en)) {
    expect(translated,source).not.toMatch(/[\u3400-\u9fff]/)
    expect((translated.match(/\{\d+\}/g)||[]).sort(),source).toEqual((source.match(/\{\d+\}/g)||[]).sort())
  }
})
