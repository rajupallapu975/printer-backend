const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

/**
 * Generates an enhanced ZIKRINT branded cover page PDF on the fly
 */
async function generateCoverPage(orderData) {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.276, 841.89]); // A4 Size
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Helper functions
    const drawText = (text, x, y, size = 10, font = helvetica, color = rgb(0.1, 0.1, 0.1)) => {
        page.drawText(text, { x, y, size, font, color });
    };

    const drawCenteredText = (text, y, size = 10, font = helvetica, color = rgb(0.1, 0.1, 0.1)) => {
        const textWidth = font.widthOfTextAtSize(text, size);
        const x = (595.276 - textWidth) / 2;
        page.drawText(text, { x, y, size, font, color });
    };

    const drawLine = (startX, startY, endX, endY, thickness = 1, color = rgb(0.8, 0.8, 0.8), isDotted = false) => {
        if (isDotted) {
            const distance = Math.sqrt((endX - startX)**2 + (endY - startY)**2);
            const dotSpacing = 4;
            const numDots = Math.floor(distance / dotSpacing);
            const dx = (endX - startX) / numDots;
            const dy = (endY - startY) / numDots;
            for (let i = 0; i <= numDots; i++) {
                page.drawCircle({
                    x: startX + i * dx,
                    y: startY + i * dy,
                    radius: thickness / 2,
                    color,
                });
            }
        } else {
            page.drawLine({
                start: { x: startX, y: startY },
                end: { x: endX, y: endY },
                thickness,
                color,
            });
        }
    };

    // Draw main frame border
    page.drawRectangle({
        x: 20,
        y: 20,
        width: 555.276,
        height: 801.89,
        borderColor: rgb(0.9, 0.9, 0.9),
        borderWidth: 1,
        color: rgb(1, 1, 1),
    });

    // -------------------------------------------------------------
    // SECTION 1: HEADER
    // -------------------------------------------------------------
    // ZIKRINT Logo & Tagline (Left side)
    page.drawRectangle({ x: 35, y: 778, width: 10, height: 3, color: rgb(0.1, 0.1, 0.1) });
    page.drawRectangle({ x: 35, y: 772, width: 14, height: 3, color: rgb(0.1, 0.1, 0.1) });
    page.drawRectangle({ x: 35, y: 766, width: 8, height: 3, color: rgb(0.1, 0.1, 0.1) });
    
    drawText("ZIKRINT", 55, 768, 22, helveticaBold);
    drawText("Your Print, Our Responsibility", 55, 755, 8, helvetica, rgb(0.4, 0.4, 0.4));

    // Promo banner (Right side)
    page.drawRectangle({
        x: 400,
        y: 745,
        width: 160,
        height: 48,
        borderColor: rgb(0.8, 0.8, 0.8),
        borderWidth: 1,
        color: rgb(1, 1, 1),
    });
    drawText("Print Smarter. Save Time.", 410, 778, 8, helveticaBold, rgb(0.1, 0.1, 0.1));
    drawText("Upload - Pay - Print - Pickup", 410, 765, 7.5, helvetica, rgb(0.3, 0.3, 0.3));
    drawText("All in One App!", 410, 753, 8.5, helveticaBold, rgb(0.1, 0.1, 0.1));

    // Section line divider
    drawLine(35, 735, 560.276, 735, 1, rgb(0.85, 0.85, 0.85));

    // -------------------------------------------------------------
    // SECTION 2: PICKUP CODE
    // -------------------------------------------------------------
    drawCenteredText("PICKUP CODE", 715, 11, helveticaBold, rgb(0.5, 0.5, 0.5));
    drawCenteredText(`#${orderData.orderCode}`, 670, 36, helveticaBold, rgb(0.1, 0.1, 0.1));

    // SHOW THIS CODE container
    const badgeText = "SHOW THIS CODE AT THE SHOP TO PICK UP YOUR PRINT";
    const badgeWidth = helveticaBold.widthOfTextAtSize(badgeText, 8.5);
    const badgeX = (595.276 - (badgeWidth + 24)) / 2;
    page.drawRectangle({
        x: badgeX,
        y: 640,
        width: badgeWidth + 24,
        height: 20,
        borderColor: rgb(0.85, 0.85, 0.85),
        borderWidth: 1,
        color: rgb(0.97, 0.97, 0.97),
    });
    drawText(badgeText, badgeX + 12, 646, 8.5, helveticaBold, rgb(0.2, 0.2, 0.2));

    drawLine(35, 625, 560.276, 625, 1, rgb(0.85, 0.85, 0.85), true); // dotted line

    // -------------------------------------------------------------
    // SECTION 3: CUSTOMER DETAILS
    // -------------------------------------------------------------
    drawCenteredText("CUSTOMER DETAILS", 605, 10, helveticaBold, rgb(0.4, 0.4, 0.4));
    drawCenteredText("Customer Name", 590, 8.5, helvetica, rgb(0.5, 0.5, 0.5));
    drawCenteredText(orderData.customerName || "Guest User", 572, 14, helveticaBold, rgb(0.1, 0.1, 0.1));

    drawLine(35, 555, 560.276, 555, 1, rgb(0.85, 0.85, 0.85), true); // dotted line

    // -------------------------------------------------------------
    // SECTION 4: ORDER SUMMARY TABLE
    // -------------------------------------------------------------
    drawText("ORDER SUMMARY", 35, 538, 10, helveticaBold, rgb(0.4, 0.4, 0.4));

    // Table coordinates
    const tableTop = 525;
    const tableLeft = 35;
    const tableWidth = 525.276;
    const colWidths = [25, 230, 60, 70, 70, 70]; // total = 525
    const headers = ["#", "FILE NAME", "COPIES", "PAGES/COPY", "TOTAL PAGES", "PRICE"];
    
    // Draw table header background
    page.drawRectangle({
        x: tableLeft,
        y: tableTop - 18,
        width: tableWidth,
        height: 18,
        color: rgb(0.95, 0.95, 0.95),
        borderColor: rgb(0.85, 0.85, 0.85),
        borderWidth: 1,
    });

    let currentX = tableLeft;
    headers.forEach((header, idx) => {
        const alignRight = idx >= 2;
        const font = helveticaBold;
        const size = 8;
        const textWidth = font.widthOfTextAtSize(header, size);
        let xPos = currentX + 6;
        if (alignRight) {
            xPos = currentX + colWidths[idx] - textWidth - 8;
        }
        page.drawText(header, { x: xPos, y: tableTop - 13, size, font, color: rgb(0.2, 0.2, 0.2) });
        currentX += colWidths[idx];
    });

    // Draw data rows
    let currentY = tableTop - 18;
    const rowHeight = 20;

    orderData.files.forEach((file, index) => {
        page.drawRectangle({
            x: tableLeft,
            y: currentY - rowHeight,
            width: tableWidth,
            height: rowHeight,
            borderColor: rgb(0.88, 0.88, 0.88),
            borderWidth: 1,
            color: rgb(1, 1, 1),
        });

        const rowValues = [
            (index + 1).toString(),
            file.fileName.length > 38 ? file.fileName.substring(0, 35) + "..." : file.fileName,
            file.copies.toString(),
            file.pageCount.toString(),
            (file.pageCount * file.copies).toString(),
            `Rs. ${(file.price || 0.0).toFixed(2)}`
        ];

        let colX = tableLeft;
        rowValues.forEach((val, idx) => {
            const alignRight = idx >= 2;
            const font = helvetica;
            const size = 8.5;
            const textWidth = font.widthOfTextAtSize(val, size);
            let xPos = colX + 6;
            if (alignRight) {
                xPos = colX + colWidths[idx] - textWidth - 8;
            }
            page.drawText(val, { x: xPos, y: currentY - 14, size, font, color: rgb(0.15, 0.15, 0.15) });
            colX += colWidths[idx];
        });

        currentY -= rowHeight;
    });

    // Table Footer (Total Printable Pages)
    page.drawRectangle({
        x: tableLeft,
        y: currentY - rowHeight,
        width: tableWidth,
        height: rowHeight,
        color: rgb(0.97, 0.97, 0.97),
        borderColor: rgb(0.85, 0.85, 0.85),
        borderWidth: 1,
    });

    const totalPrintablePages = orderData.files.reduce((sum, f) => sum + (f.pageCount * f.copies), 0);
    const subtotalCost = orderData.files.reduce((sum, f) => sum + (f.price || 0.0), 0.0);

    drawText("TOTAL PRINTABLE PAGES (Sum of Pages x Copies)", tableLeft + 150, currentY - 14, 8, helveticaBold, rgb(0.2, 0.2, 0.2));
    
    const pagesValText = totalPrintablePages.toString();
    const pagesValWidth = helveticaBold.widthOfTextAtSize(pagesValText, 8.5);
    const pagesColX = tableLeft + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3];
    page.drawText(pagesValText, {
        x: pagesColX + colWidths[4] - pagesValWidth - 8,
        y: currentY - 14,
        size: 8.5,
        font: helveticaBold,
        color: rgb(0.1, 0.1, 0.1)
    });

    const priceValText = `Rs. ${subtotalCost.toFixed(2)}`;
    const priceValWidth = helveticaBold.widthOfTextAtSize(priceValText, 8.5);
    const priceColX = pagesColX + colWidths[4];
    page.drawText(priceValText, {
        x: priceColX + colWidths[5] - priceValWidth - 8,
        y: currentY - 14,
        size: 8.5,
        font: helveticaBold,
        color: rgb(0.1, 0.1, 0.1)
    });

    currentY -= rowHeight;

    // -------------------------------------------------------------
    // SECTION 5 & 6: ORDER INFO & PRICE BREAKDOWN (Side-by-side)
    // -------------------------------------------------------------
    const cardY = currentY - 100;
    const cardHeight = 85;
    const cardWidth = 250;

    // Card 1: ORDER INFORMATION
    page.drawRectangle({
        x: tableLeft,
        y: cardY,
        width: cardWidth,
        height: cardHeight,
        borderColor: rgb(0.85, 0.85, 0.85),
        borderWidth: 1,
        color: rgb(1, 1, 1),
    });
    drawText("ORDER INFORMATION", tableLeft + 12, cardY + 70, 9, helveticaBold, rgb(0.3, 0.3, 0.3));
    
    drawText("Total Files", tableLeft + 12, cardY + 50, 8.5, helvetica, rgb(0.4, 0.4, 0.4));
    drawText(orderData.files.length.toString(), tableLeft + 220, cardY + 50, 8.5, helveticaBold);

    drawText("Total Copies", tableLeft + 12, cardY + 32, 8.5, helvetica, rgb(0.4, 0.4, 0.4));
    const totalCopiesCount = orderData.files.reduce((sum, f) => sum + f.copies, 0);
    drawText(totalCopiesCount.toString(), tableLeft + 220, cardY + 32, 8.5, helveticaBold);

    drawText("Total Printable Pages", tableLeft + 12, cardY + 14, 8.5, helvetica, rgb(0.4, 0.4, 0.4));
    drawText(totalPrintablePages.toString(), tableLeft + 220, cardY + 14, 8.5, helveticaBold);

    // Card 2: PRICE BREAKDOWN
    const card2X = tableLeft + 275.276;
    page.drawRectangle({
        x: card2X,
        y: cardY,
        width: cardWidth,
        height: cardHeight,
        borderColor: rgb(0.85, 0.85, 0.85),
        borderWidth: 1,
        color: rgb(1, 1, 1),
    });
    drawText("PRICE BREAKDOWN", card2X + 12, cardY + 70, 9, helveticaBold, rgb(0.3, 0.3, 0.3));

    drawText("Subtotal (Printing Charges)", card2X + 12, cardY + 50, 8.5, helvetica, rgb(0.4, 0.4, 0.4));
    const subtotalText = `Rs. ${subtotalCost.toFixed(2)}`;
    const subtotalWidth = helveticaBold.widthOfTextAtSize(subtotalText, 8.5);
    page.drawText(subtotalText, { x: card2X + cardWidth - subtotalWidth - 12, y: cardY + 50, size: 8.5, font: helveticaBold });

    drawText("Extra Page Charge (Cover Page)", card2X + 12, cardY + 32, 8.5, helvetica, rgb(0.4, 0.4, 0.4));
    const coverChargeText = `Rs. ${(orderData.coverPageCharge || 2.0).toFixed(2)}`;
    const coverChargeWidth = helveticaBold.widthOfTextAtSize(coverChargeText, 8.5);
    page.drawText(coverChargeText, { x: card2X + cardWidth - coverChargeWidth - 12, y: cardY + 32, size: 8.5, font: helveticaBold });

    drawLine(card2X + 10, cardY + 24, card2X + cardWidth - 10, cardY + 24, 0.5, rgb(0.85, 0.85, 0.85));

    drawText("GRAND TOTAL", card2X + 12, cardY + 8, 9.5, helveticaBold, rgb(0.1, 0.1, 0.1));
    const grandTotalVal = subtotalCost + (orderData.coverPageCharge || 2.0);
    const grandTotalText = `Rs. ${grandTotalVal.toFixed(2)}`;
    const grandTotalWidth = helveticaBold.widthOfTextAtSize(grandTotalText, 10.5);
    
    page.drawRectangle({
        x: card2X + cardWidth - grandTotalWidth - 22,
        y: cardY + 4,
        width: grandTotalWidth + 14,
        height: 16,
        color: rgb(0.15, 0.15, 0.15),
        borderColor: rgb(0.15, 0.15, 0.15),
        borderWidth: 1,
    });
    page.drawText(grandTotalText, {
        x: card2X + cardWidth - grandTotalWidth - 15,
        y: cardY + 8,
        size: 9.5,
        font: helveticaBold,
        color: rgb(1, 1, 1)
    });

    // -------------------------------------------------------------
    // SECTION 7: IMPORTANT NOTE
    // -------------------------------------------------------------
    const noteY = cardY - 45;
    page.drawRectangle({
        x: tableLeft,
        y: noteY,
        width: tableWidth,
        height: 32,
        color: rgb(0.97, 0.97, 0.97),
        borderColor: rgb(0.88, 0.88, 0.88),
        borderWidth: 1,
    });
    
    drawText("IMPORTANT NOTE:", tableLeft + 12, noteY + 20, 8.5, helveticaBold, rgb(0.2, 0.2, 0.2));
    drawText("A cover page with this order details will be printed first. Thank you for choosing our service!", tableLeft + 12, noteY + 8, 8, helvetica, rgb(0.4, 0.4, 0.4));

    // -------------------------------------------------------------
    // SECTION 8: FOOTER BRANDING
    // -------------------------------------------------------------
    const footerY = 42;
    page.drawRectangle({ x: tableLeft, y: footerY + 12, width: 8, height: 2, color: rgb(0.1, 0.1, 0.1) });
    page.drawRectangle({ x: tableLeft, y: footerY + 8, width: 11, height: 2, color: rgb(0.1, 0.1, 0.1) });
    page.drawRectangle({ x: tableLeft, y: footerY + 4, width: 6, height: 2, color: rgb(0.1, 0.1, 0.1) });
    
    drawText("ZIKRINT", tableLeft + 15, footerY + 5, 14, helveticaBold);
    drawText("Smart Printing. Simplified!", tableLeft, footerY - 6, 8, helvetica, rgb(0.4, 0.4, 0.4));

    // Workflow representation (Right side)
    const workflowX = tableLeft + 180;
    const workflowSpacing = 55;
    const steps = [
        { label: "Upload", sub: "your files", icon: "STEP 1" },
        { label: "Secure", sub: "Payments", icon: "STEP 2" },
        { label: "Print", sub: "Quality", icon: "STEP 3" },
        { label: "Easy", sub: "Pickup", icon: "STEP 4" }
    ];

    steps.forEach((step, idx) => {
        const xPos = workflowX + idx * workflowSpacing;
        drawText(step.icon, xPos - 5, footerY + 10, 7, helveticaBold, rgb(0.4, 0.4, 0.4));
        drawText(step.label, xPos - 5, footerY - 2, 7.5, helveticaBold, rgb(0.2, 0.2, 0.2));
        drawText(step.sub, xPos - 5, footerY - 10, 6.5, helvetica, rgb(0.4, 0.4, 0.4));
        if (idx < steps.length - 1) {
            drawText("->", xPos + 32, footerY + 3, 9, helveticaBold, rgb(0.6, 0.6, 0.6));
        }
    });

    // Dark banner at the very bottom
    page.drawRectangle({
        x: 20,
        y: 20,
        width: 555.276,
        height: 16,
        color: rgb(0.1, 0.1, 0.1),
    });
    drawCenteredText("THANK YOU FOR CHOOSING ZIKRINT - YOUR TRUST, OUR MOTIVATION!", 24, 7, helveticaBold, rgb(1, 1, 1));

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
}

module.exports = { generateCoverPage };
