// ── Export a weather graphic to a shareable PDF ──────────────────────────────
// Lightweight helper that downloads the graphic's image and embeds it into a
// PDF along with the title, description, and metadata. Returns nothing — the
// browser saves the file directly.
import jsPDF from 'jspdf';

function stripHtml(html = '') {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || '').trim();
}

async function loadImageAsDataURL(url) {
  const res = await fetch(url, { mode: 'cors' });
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function imgDims(dataUrl) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve({ w: im.width, h: im.height });
    im.onerror = () => resolve({ w: 1024, h: 1024 });
    im.src = dataUrl;
  });
}

export async function exportGraphicAsPDF(graphic) {
  if (!graphic) return;

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 40;
  let y = margin;

  // Title
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.setTextColor(20, 20, 20);
  const titleLines = pdf.splitTextToSize(graphic.title || 'Weather Graphic', pageW - margin * 2);
  pdf.text(titleLines, margin, y);
  y += titleLines.length * 22;

  // Metadata line
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(110, 110, 110);
  const meta = [];
  if (graphic.weather_condition) meta.push(graphic.weather_condition);
  if (graphic.impact_level) meta.push(`Impact: ${graphic.impact_level}`);
  if (graphic.created_date) meta.push(new Date(graphic.created_date).toLocaleString());
  if (meta.length) {
    pdf.text(meta.join('  ·  '), margin, y);
    y += 16;
  }

  // Image — higher quality rendering
  if (graphic.image_url) {
    try {
      const dataUrl = await loadImageAsDataURL(graphic.image_url);
      const { w, h } = await imgDims(dataUrl);
      const maxW = pageW - margin * 2;
      const maxH = pageH - y - margin - 40;
      const ratio = Math.min(maxW / w, maxH / h);
      const drawW = w * ratio;
      const drawH = h * ratio;
      const x = (pageW - drawW) / 2;
      const fmt = dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      pdf.addImage(dataUrl, fmt, x, y, drawW, drawH, undefined, 'FAST');
      y += drawH + 16;
    } catch {
      // skip image if download fails
    }
  }

  // Description
  const desc = stripHtml(graphic.description);
  if (desc) {
    if (y > pageH - margin - 80) { pdf.addPage(); y = margin; }
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(11);
    pdf.setTextColor(40, 40, 40);
    const lines = pdf.splitTextToSize(desc, pageW - margin * 2);
    pdf.text(lines, margin, y);
    y += lines.length * 14 + 8;
  }

  // NOTE: Impacted locations intentionally omitted from PDF output

  const safeTitle = (graphic.title || 'weather-graphic').replace(/[^\w\-]+/g, '_').slice(0, 60);
  pdf.save(`${safeTitle}.pdf`);
}

/**
 * Download the outlook map element as a high-resolution PNG image.
 * Uses html2canvas at 3× device-pixel ratio for sharp output.
 * Falls back to a basic screenshot if html2canvas is unavailable.
 *
 * @param {HTMLElement} mapElement - The DOM element containing the map
 * @param {string} title - File name prefix
 */
export async function downloadOutlookAsImage(mapElement, title = 'outlook') {
  if (!mapElement) return;

  const safeTitle = title.replace(/[^\w\-\s]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60)
    || 'outlook';

  try {
    // Dynamically load html2canvas if not already available
    if (!window.html2canvas) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    const canvas = await window.html2canvas(mapElement, {
      scale: 3,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#0f172a',
      logging: false,
    });
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `${safeTitle}_${new Date().toISOString().slice(0, 10)}.png`;
    link.click();
  } catch (err) {
    console.warn('[downloadOutlookAsImage] html2canvas failed, trying fallback:', err);
    // Fallback: if there is a canvas inside the element, download that directly
    const canvases = mapElement.querySelectorAll('canvas');
    if (canvases.length > 0) {
      const link = document.createElement('a');
      link.href = canvases[0].toDataURL('image/png');
      link.download = `${safeTitle}_${new Date().toISOString().slice(0, 10)}.png`;
      link.click();
    } else {
      console.error('[downloadOutlookAsImage] No canvas found for fallback');
    }
  }
}

/**
 * Export the current outlook as a PDF — map + synopsis text.
 * Captures the map element at high resolution and embeds it with the synopsis.
 *
 * @param {HTMLElement} mapElement - DOM node of the map
 * @param {string} title - Outlook title
 * @param {string} synopsis - Plain text synopsis (markdown stripped)
 * @param {string} riskLevel - e.g. "Moderate"
 * @param {string} date - e.g. "Wednesday 28 May 2025"
 */
export async function exportOutlookAsPDF(mapElement, { title = 'TCM Outlook', synopsis = '', riskLevel = '', date = '' } = {}) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const margin = 40;
  let y = margin;

  // Header bar
  pdf.setFillColor(15, 23, 42);
  pdf.rect(0, 0, pageW, 54, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.setTextColor(241, 245, 249);
  pdf.text('MyWeatherUK — TCM Outlook', margin, 34);
  y = 70;

  // Title
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.setTextColor(20, 20, 20);
  const titleLines = pdf.splitTextToSize(title, pageW - margin * 2);
  pdf.text(titleLines, margin, y);
  y += titleLines.length * 18 + 4;

  // Date + risk level
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(100, 100, 100);
  const meta = [date, riskLevel ? `Risk: ${riskLevel}` : '', `Generated: ${new Date().toLocaleString('en-GB')}`].filter(Boolean).join('  ·  ');
  pdf.text(meta, margin, y);
  y += 20;

  // Map image
  if (mapElement) {
    try {
      if (!window.html2canvas) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
          s.onload = resolve; s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      const canvas = await window.html2canvas(mapElement, {
        scale: 2, useCORS: true, allowTaint: false,
        backgroundColor: '#0f172a', logging: false,
      });
      const dataUrl = canvas.toDataURL('image/png');
      const { w, h } = await imgDims(dataUrl);
      const maxW = pageW - margin * 2;
      const maxH = 380;
      const ratio = Math.min(maxW / w, maxH / h);
      const drawW = w * ratio;
      const drawH = h * ratio;
      pdf.addImage(dataUrl, 'PNG', (pageW - drawW) / 2, y, drawW, drawH, undefined, 'FAST');
      y += drawH + 16;
    } catch { /* skip map if capture fails */ }
  }

  // Synopsis
  if (synopsis) {
    const clean = synopsis.replace(/\*\*(.*?)\*\*/g, '$1').replace(/📡/g, '').trim();
    if (y > pdf.internal.pageSize.getHeight() - margin - 60) { pdf.addPage(); y = margin; }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor(60, 60, 60);
    pdf.text('Outlook Synopsis', margin, y);
    y += 14;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(40, 40, 40);
    const lines = pdf.splitTextToSize(clean, pageW - margin * 2);
    pdf.text(lines, margin, y);
    y += lines.length * 12 + 8;
  }

  // Footer
  const footerY = pdf.internal.pageSize.getHeight() - 22;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(150, 150, 150);
  pdf.text('myweatheruk.com — Thunderstorm Climatology Monitor (TCM)', margin, footerY);

  const safeTitle = title.replace(/[^\w\-\s]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'tcm_outlook';
  pdf.save(`${safeTitle}_${new Date().toISOString().slice(0, 10)}.pdf`);
}