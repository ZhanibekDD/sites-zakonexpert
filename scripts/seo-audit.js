#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const verificationFile = /^(?:google|yandex_).*\.html$/i;
const files = fs.readdirSync(PUBLIC_DIR)
  .filter(name => name.endsWith('.html') && name !== '404.html' && !verificationFile.test(name));

const issues = [];
const canonicals = new Map();
const titles = new Map();

function add(file, severity, message) {
  issues.push({ file, severity, message });
}

for (const file of files) {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1].trim() || '';
  const description = html.match(/<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']*)/i)?.[1].trim() || '';
  const canonical = html.match(/<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)/i)?.[1].trim() || '';
  const h1Count = (html.match(/<h1(?:\s|>)/gi) || []).length;
  const imagesWithoutAlt = html.match(/<img\b(?![^>]*\balt=)[^>]*>/gi) || [];

  if (!title) add(file, 'error', 'missing <title>');
  if (!description) add(file, 'error', 'missing meta description');
  if (!canonical) add(file, 'error', 'missing canonical');
  if (h1Count !== 1) add(file, 'error', `expected one H1, found ${h1Count}`);
  if (imagesWithoutAlt.length) add(file, 'error', `${imagesWithoutAlt.length} image(s) without alt`);
  if (/stopnadpis@mail\.ru|\+7\s*\(700\)\s*030-00-24|tel:\+77000300024/i.test(html)) {
    add(file, 'error', 'contains an obsolete contact');
  }

  if (title) {
    if (titles.has(title)) add(file, 'warning', `duplicate title with ${titles.get(title)}`);
    else titles.set(title, file);
  }
  if (canonical) {
    if (!/^https:\/\/zakonexpertt\.kz\//.test(canonical)) add(file, 'error', 'canonical is not an absolute production URL');
    if (canonicals.has(canonical)) add(file, 'warning', `duplicate canonical with ${canonicals.get(canonical)}`);
    else canonicals.set(canonical, file);
  }
}

const errors = issues.filter(item => item.severity === 'error');
const warnings = issues.filter(item => item.severity === 'warning');

for (const item of issues) {
  console.log(`${item.severity === 'error' ? 'ERROR' : 'WARN '} ${item.file}: ${item.message}`);
}
console.log(`SEO audit: ${files.length} static pages, ${errors.length} errors, ${warnings.length} warnings`);
if (errors.length) process.exitCode = 1;
