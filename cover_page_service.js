const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

// Pure B&W color palette — NO grey fills anywhere
const BLACK  = rgb(0, 0, 0);
const WHITE  = rgb(1, 1, 1);
const GREY_BORDER = rgb(0.6, 0.6, 0.6);   // border lines only
const GREY_TEXT   = rgb(0.3, 0.3, 0.3);   // secondary text only

/**
 * Generates a ZIKRINT cover page PDF — 100% black and white, printer-friendly
 */
async function generateCoverPage(orderData) {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.276, 841.89]); // A4
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // ── Helpers ──────────────────────────────────────────────────
    const text = (str, x, y, size = 10, font = helvetica, color = BLACK) => {
        page.drawText(str, { x, y, size, font, color });
    };

    const centeredText = (str, y, size = 10, font = helvetica, color = BLACK) => {
        const w = font.widthOfTextAtSize(str, size);
        page.drawText(str, { x: (595.276 - w) / 2, y, size, font, color });
    };

    const hLine = (y, x1 = 35, x2 = 560.276, thickness = 0.5, dotted = false) => {
        if (dotted) {
            const gap = 5;
            for (let x = x1; x < x2; x += gap * 2) {
                page.drawLine({ start: { x, y }, end: { x: Math.min(x + gap, x2), y }, thickness, color: GREY_BORDER });
            }
        } else {
            page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color: GREY_BORDER });
        }
    };

    const rect = (x, y, w, h, { fill = WHITE, border = GREY_BORDER, bw = 0.5 } = {}) => {
        page.drawRectangle({ x, y, width: w, height: h, color: fill, borderColor: border, borderWidth: bw });
    };

    // ── Outer frame ───────────────────────────────────────────────
    rect(20, 20, 555.276, 801.89, { fill: WHITE, border: GREY_BORDER, bw: 1 });

    // ─────────────────────────────────────────────────────────────
    // SECTION 1: HEADER
    // ─────────────────────────────────────────────────────────────
    // Hamburger logo bars (black)
    rect(35, 778, 10, 3, { fill: BLACK, border: BLACK, bw: 0 });
    rect(35, 772, 14, 3, { fill: BLACK, border: BLACK, bw: 0 });
    rect(35, 766,  8, 3, { fill: BLACK, border: BLACK, bw: 0 });

    text('ZIKRINT', 55, 768, 22, helveticaBold, BLACK);
    text('Your Print, Our Responsibility', 55, 755, 8, helvetica, GREY_TEXT);

    // Promo box (white fill, grey border)
    rect(390, 745, 170, 48, { fill: WHITE, border: GREY_BORDER, bw: 0.8 });
    text('Print Smarter. Save Time.',    400, 778, 8,   helveticaBold, BLACK);
    text('Upload - Pay - Print - Pickup',400, 765, 7.5, helvetica,     GREY_TEXT);
    text('All in One App!',              400, 753, 8.5, helveticaBold, BLACK);

    hLine(735);

    // ─────────────────────────────────────────────────────────────
    // SECTION 2: PICKUP CODE  +  UNIQUE CODE
    // ─────────────────────────────────────────────────────────────
    centeredText('PICKUP CODE', 720, 9, helveticaBold, GREY_TEXT);
    centeredText(`#${orderData.orderCode}`, 682, 32, helveticaBold, BLACK);

    if (orderData.customId) {
        const ucBoxW = 320;
        const ucBoxX = (595.276 - ucBoxW) / 2;
        const ucBoxY = 650;
        const ucBoxH = 26;

        // Box: white fill, solid black border so it's always visible
        rect(ucBoxX, ucBoxY, ucBoxW, ucBoxH, { fill: WHITE, border: BLACK, bw: 1 });

        const label    = 'UNIQUE CODE:';
        const labelW   = helveticaBold.widthOfTextAtSize(label, 8.5);
        const val      = orderData.customId.toUpperCase();
        const valW     = helveticaBold.widthOfTextAtSize(val, 10);
        const startX   = ucBoxX + (ucBoxW - labelW - 6 - valW) / 2;

        page.drawText(label, { x: startX,             y: ucBoxY + 9, size: 8.5, font: helveticaBold, color: GREY_TEXT });
        page.drawText(val,   { x: startX + labelW + 6, y: ucBoxY + 9, size: 10,  font: helveticaBold, color: BLACK });
    }

    // "SHOW THIS CODE" badge
    const badgeY  = orderData.customId ? 630 : 656;
    const badgeW  = 480;
    const badgeX  = (595.276 - badgeW) / 2;
    rect(badgeX, badgeY, badgeW, 18, { fill: WHITE, border: GREY_BORDER, bw: 0.5 });
    centeredText('SHOW THIS CODE AT THE SHOP TO PICK UP YOUR PRINT', badgeY + 5, 7.5, helveticaBold, BLACK);

    hLine(badgeY - 10, 35, 560.276, 0.5, true);

    // ─────────────────────────────────────────────────────────────
    // SECTION 3: CUSTOMER DETAILS
    // ─────────────────────────────────────────────────────────────
    centeredText('CUSTOMER DETAILS', 575, 10, helveticaBold, GREY_TEXT);
    centeredText('Customer Name',    560, 8.5, helvetica,     GREY_TEXT);
    centeredText(orderData.customerName || 'Guest User', 542, 14, helveticaBold, BLACK);

    hLine(525, 35, 560.276, 0.5, true);

    // ─────────────────────────────────────────────────────────────
    // SECTION 4: ORDER SUMMARY TABLE
    // ─────────────────────────────────────────────────────────────
    text('ORDER SUMMARY', 35, 508, 10, helveticaBold, BLACK);

    const tableLeft  = 35;
    const tableWidth = 525.276;
    const tableTop   = 495;
    const colWidths  = [25, 230, 60, 70, 70, 70];
    const headers    = ['#', 'FILE NAME', 'COPIES', 'PAGES/COPY', 'TOTAL PAGES', 'PRICE'];

    // Header row — white fill, black border
    rect(tableLeft, tableTop - 18, tableWidth, 18, { fill: WHITE, border: BLACK, bw: 0.8 });

    let curX = tableLeft;
    headers.forEach((h, i) => {
        const w = helveticaBold.widthOfTextAtSize(h, 8);
        const x = i >= 2 ? curX + colWidths[i] - w - 8 : curX + 6;
        page.drawText(h, { x, y: tableTop - 13, size: 8, font: helveticaBold, color: BLACK });
        curX += colWidths[i];
    });

    // Data rows
    let curY = tableTop - 18;
    const rowH = 20;

    orderData.files.forEach((file, idx) => {
        rect(tableLeft, curY - rowH, tableWidth, rowH, { fill: WHITE, border: GREY_BORDER, bw: 0.5 });

        const vals = [
            (idx + 1).toString(),
            file.fileName.length > 38 ? file.fileName.substring(0, 35) + '...' : file.fileName,
            file.copies.toString(),
            file.pageCount.toString(),
            (file.pageCount * file.copies).toString(),
            `Rs. ${(file.price || 0).toFixed(2)}`
        ];

        let colX = tableLeft;
        vals.forEach((v, i) => {
            const w = helvetica.widthOfTextAtSize(v, 8.5);
            const x = i >= 2 ? colX + colWidths[i] - w - 8 : colX + 6;
            page.drawText(v, { x, y: curY - 14, size: 8.5, font: helvetica, color: BLACK });
            colX += colWidths[i];
        });
        curY -= rowH;
    });

    // Table footer row
    const totalPages   = orderData.files.reduce((s, f) => s + f.pageCount * f.copies, 0);
    const subtotal     = orderData.files.reduce((s, f) => s + (f.price || 0), 0);

    rect(tableLeft, curY - rowH, tableWidth, rowH, { fill: WHITE, border: BLACK, bw: 0.8 });
    text('TOTAL PRINTABLE PAGES (Sum of Pages x Copies)', tableLeft + 140, curY - 14, 7.5, helveticaBold, BLACK);

    const pColX = tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3];
    const pgW = helveticaBold.widthOfTextAtSize(totalPages.toString(), 8.5);
    page.drawText(totalPages.toString(), { x: pColX + colWidths[4] - pgW - 8, y: curY - 14, size: 8.5, font: helveticaBold, color: BLACK });

    const priceStr = `Rs. ${subtotal.toFixed(2)}`;
    const priceW   = helveticaBold.widthOfTextAtSize(priceStr, 8.5);
    page.drawText(priceStr, { x: pColX + colWidths[4] + colWidths[5] - priceW - 8, y: curY - 14, size: 8.5, font: helveticaBold, color: BLACK });

    curY -= rowH;

    // ─────────────────────────────────────────────────────────────
    // SECTION 5 & 6: ORDER INFO  |  PRICE BREAKDOWN (side-by-side)
    // ─────────────────────────────────────────────────────────────
    const cardY  = curY - 100;
    const cardH  = 90;
    const cardW  = 250;

    // Card 1 — ORDER INFORMATION
    rect(tableLeft, cardY, cardW, cardH, { fill: WHITE, border: GREY_BORDER, bw: 0.8 });
    text('ORDER INFORMATION', tableLeft + 12, cardY + 74, 9, helveticaBold, BLACK);

    text('Total Files',            tableLeft + 12, cardY + 54, 8, helvetica,     GREY_TEXT);
    text(orderData.files.length.toString(), tableLeft + 220, cardY + 54, 8, helveticaBold, BLACK);

    const totalCopies = orderData.files.reduce((s, f) => s + f.copies, 0);
    text('Total Copies',           tableLeft + 12, cardY + 36, 8, helvetica,     GREY_TEXT);
    text(totalCopies.toString(),   tableLeft + 220, cardY + 36, 8, helveticaBold, BLACK);

    text('Total Printable Pages',  tableLeft + 12, cardY + 18, 8, helvetica,     GREY_TEXT);
    text(totalPages.toString(),    tableLeft + 220, cardY + 18, 8, helveticaBold, BLACK);

    // Card 2 — PRICE BREAKDOWN
    const c2X = tableLeft + 275.276;
    rect(c2X, cardY, cardW, cardH, { fill: WHITE, border: GREY_BORDER, bw: 0.8 });
    text('PRICE BREAKDOWN', c2X + 12, cardY + 74, 9, helveticaBold, BLACK);

    const roundedFee = Math.ceil(orderData.platformFee || 2.0);
    const coverCharge = orderData.coverPageCharge || 2.0;
    const grandTotal  = subtotal + roundedFee + coverCharge;

    const priceRow = (label, amount, y) => {
        text(label, c2X + 12, y, 8, helvetica, GREY_TEXT);
        const valStr = `Rs. ${amount.toFixed(2)}`;
        const vw = helveticaBold.widthOfTextAtSize(valStr, 8);
        page.drawText(valStr, { x: c2X + cardW - vw - 12, y, size: 8, font: helveticaBold, color: BLACK });
    };

    priceRow('Subtotal (Printing Charges)', subtotal,    cardY + 56);
    priceRow('Platform Fee',                roundedFee,  cardY + 42);
    priceRow('Cover Page Charge',           coverCharge, cardY + 28);

    hLine(cardY + 21, c2X + 10, c2X + cardW - 10, 0.5);

    // Grand Total box — black fill, white text
    text('GRAND TOTAL', c2X + 12, cardY + 7, 9.5, helveticaBold, BLACK);
    const gtStr = `Rs. ${grandTotal.toFixed(2)}`;
    const gtW   = helveticaBold.widthOfTextAtSize(gtStr, 9.5);
    rect(c2X + cardW - gtW - 22, cardY + 3, gtW + 14, 16, { fill: BLACK, border: BLACK, bw: 0 });
    page.drawText(gtStr, { x: c2X + cardW - gtW - 15, y: cardY + 7, size: 9.5, font: helveticaBold, color: WHITE });

    // ─────────────────────────────────────────────────────────────
    // SECTION 7: IMPORTANT NOTE
    // ─────────────────────────────────────────────────────────────
    const noteY = cardY - 45;
    rect(tableLeft, noteY, tableWidth, 32, { fill: WHITE, border: GREY_BORDER, bw: 0.5 });
    text('IMPORTANT NOTE:', tableLeft + 12, noteY + 20, 8.5, helveticaBold, BLACK);
    text('A cover page with this order details will be printed first. Thank you for choosing our service!', tableLeft + 12, noteY + 8, 7.5, helvetica, GREY_TEXT);

    // ─────────────────────────────────────────────────────────────
    // SECTION 8: FOOTER
    // ─────────────────────────────────────────────────────────────
    const footerY = 42;
    rect(tableLeft,      footerY + 12, 10, 2, { fill: BLACK, border: BLACK, bw: 0 });
    rect(tableLeft,      footerY + 8,  14, 2, { fill: BLACK, border: BLACK, bw: 0 });
    rect(tableLeft,      footerY + 4,  8,  2, { fill: BLACK, border: BLACK, bw: 0 });

    text('ZIKRINT',               tableLeft + 18, footerY + 5,  14, helveticaBold, BLACK);
    text('Smart Printing. Simplified!', tableLeft, footerY - 6, 7.5, helvetica, GREY_TEXT);

    const steps = [
        { step: 'STEP 1', label: 'Upload',  sub: 'your files'  },
        { step: 'STEP 2', label: 'Secure',  sub: 'Payments'    },
        { step: 'STEP 3', label: 'Print',   sub: 'Quality'     },
        { step: 'STEP 4', label: 'Easy',    sub: 'Pickup'      },
    ];
    const wfX = tableLeft + 185;
    steps.forEach((s, i) => {
        const x = wfX + i * 55;
        text(s.step,  x, footerY + 10, 6.5, helveticaBold, GREY_TEXT);
        text(s.label, x, footerY - 2,  7.5, helveticaBold, BLACK);
        text(s.sub,   x, footerY - 11, 6.5, helvetica,     GREY_TEXT);
        if (i < steps.length - 1) text('->', x + 33, footerY + 3, 8, helveticaBold, GREY_TEXT);
    });

    // Bottom bar — black fill with white text
    rect(20, 20, 555.276, 16, { fill: BLACK, border: BLACK, bw: 0 });
    centeredText('THANK YOU FOR CHOOSING ZIKRINT - YOUR TRUST, OUR MOTIVATION!', 24, 7, helveticaBold, WHITE);

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
}

module.exports = { generateCoverPage };
