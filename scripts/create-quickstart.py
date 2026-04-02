from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.enums import TA_CENTER
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

output_path = "public/docs/OSCAR-Quick-Start-Guide.pdf"

# Register Denmark font
pdfmetrics.registerFont(TTFont("Denmark", r"C:\Users\green\OneDrive\Desktop\DENMARK.ttf"))

doc = SimpleDocTemplate(
    output_path,
    pagesize=letter,
    topMargin=0.6*inch,
    bottomMargin=0.6*inch,
    leftMargin=0.75*inch,
    rightMargin=0.75*inch
)

dark_blue = HexColor("#1d4280")
mid_blue = HexColor("#2d62b8")
gold = HexColor("#f0b800")
text_color = HexColor("#222222")
light_gray = HexColor("#666666")
green_text = HexColor("#1a5c2a")

# Header styles using Denmark font
title_style = ParagraphStyle("Title", fontSize=36, fontName="Denmark", textColor=dark_blue, alignment=TA_CENTER, spaceAfter=4, leading=42)
sub2_style = ParagraphStyle("Sub2", fontSize=16, fontName="Helvetica", textColor=mid_blue, alignment=TA_CENTER, spaceAfter=14)
subtitle_style = ParagraphStyle("Subtitle", fontSize=11, fontName="Helvetica", textColor=light_gray, alignment=TA_CENTER, spaceAfter=4)
company_style = ParagraphStyle("Company", fontSize=13, fontName="Denmark", textColor=mid_blue, alignment=TA_CENTER, spaceAfter=30)

# Body styles
section_style = ParagraphStyle("Section", fontSize=16, fontName="Helvetica-Bold", textColor=dark_blue, spaceBefore=20, spaceAfter=10)
body_style = ParagraphStyle("Body", fontSize=10.5, fontName="Helvetica", textColor=text_color, leading=16, spaceAfter=6)
bullet_style = ParagraphStyle("Bullet", fontSize=10.5, fontName="Helvetica", textColor=text_color, leading=16, leftIndent=20, spaceAfter=4)
numbered_style = ParagraphStyle("Numbered", fontSize=10.5, fontName="Helvetica", textColor=text_color, leading=16, leftIndent=20, spaceAfter=4)
tip_style = ParagraphStyle("Tip", fontSize=10, fontName="Helvetica", textColor=green_text, leading=15, leftIndent=20, spaceAfter=4)
footer_style = ParagraphStyle("Footer", fontSize=8, fontName="Helvetica", textColor=light_gray, alignment=TA_CENTER, spaceBefore=20)

story = []

# ── Clean Header ──
story.append(Spacer(1, 50))
story.append(Paragraph("OSCAR", title_style))
story.append(Spacer(1, 6))
story.append(Paragraph("Quick Start Guide", sub2_style))
story.append(HRFlowable(width="50%", thickness=2, color=gold, spaceBefore=6, spaceAfter=12))
story.append(Paragraph("Operational Service &amp; Certification Analysis Reporter", subtitle_style))
story.append(Spacer(1, 4))
story.append(Paragraph("Hydro-Wates", company_style))

# Section 1
story.append(Paragraph("1. Getting Started", section_style))
story.append(Paragraph("OSCAR is a professional live load testing and data capture application designed for use with T24 wireless load cell transmitters.", body_style))
story.append(Paragraph('<bullet>\u2022</bullet> Connect to T24 sensors via a USB dongle plugged into your computer', bullet_style))
story.append(Paragraph('<bullet>\u2022</bullet> <b>Service Mode</b> \u2014 For technicians: full job management, certificates, SharePoint integration, and CSV import', bullet_style))
story.append(Paragraph('<bullet>\u2022</bullet> <b>Customer Center</b> \u2014 For customers: live data capture, unit converter, and help resources', bullet_style))

# Section 2
story.append(Paragraph("2. Connecting Your Sensors", section_style))
story.append(Paragraph('<b>1.</b>  Plug the T24 USB dongle into your computer', numbered_style))
story.append(Paragraph('<b>2.</b>  Launch OSCAR \u2014 the status indicator will show <b>"Connected"</b> when the dongle is detected', numbered_style))
story.append(Paragraph('<b>3.</b>  Power on your T24 load cell transmitters', numbered_style))
story.append(Paragraph('<b>4.</b>  Sensors will automatically appear in the cell assignment dropdowns', numbered_style))
story.append(Paragraph('<b>5.</b>  If sensors don\'t appear, click <b>"Wake All Sensors"</b> to send a broadcast signal', numbered_style))

# Section 3
story.append(Paragraph("3. Recording Live Data", section_style))
story.append(Paragraph('<b>1.</b>  Select the number of cells you want to monitor (1\u201310)', numbered_style))
story.append(Paragraph('<b>2.</b>  Assign each cell slot to a detected sensor tag from the dropdown', numbered_style))
story.append(Paragraph('<b>3.</b>  Use <b>"Zero"</b> to tare any cell before testing (subtracts rigging weight)', numbered_style))
story.append(Paragraph('<b>4.</b>  Choose a sample rate: Continuous, 1s, 10s, 30s, or 1 minute', numbered_style))
story.append(Paragraph('<b>5.</b>  Optionally enter a session name for your recording', numbered_style))
story.append(Paragraph('<b>6.</b>  Click <b>"Start Recording"</b> to begin capturing data', numbered_style))
story.append(Paragraph('<b>7.</b>  The graph updates in real-time as data is collected', numbered_style))
story.append(Paragraph('<b>8.</b>  Click <b>"Stop Recording"</b> when your test is complete', numbered_style))

# Section 4
story.append(Paragraph("4. Saving Your Data", section_style))
story.append(Paragraph("After stopping a recording, two save options appear:", body_style))
story.append(Paragraph('<bullet>\u2022</bullet> <b>Save Data as CSV</b> \u2014 Exports all recorded data points to a spreadsheet-compatible file (.csv)', bullet_style))
story.append(Paragraph('<bullet>\u2022</bullet> <b>Save Graph as Image</b> \u2014 Saves a high-resolution screenshot of the graph as a PNG file', bullet_style))
story.append(Paragraph("Both options open a file dialog so you can choose where to save on your computer.", body_style))

# Section 5
story.append(Paragraph("5. Unit Converter", section_style))
story.append(Paragraph('Access the built-in converter from the <b>"Unit Converter"</b> tab in Customer Center.', body_style))
story.append(Paragraph('<bullet>\u2022</bullet> <b>Weight:</b> lbs, kg, short tons, metric tons, long tons, ounces, grams', bullet_style))
story.append(Paragraph('<bullet>\u2022</bullet> <b>Force:</b> kilonewtons (kN), newtons (N), pound-force (lbf)', bullet_style))
story.append(Paragraph('<bullet>\u2022</bullet> <b>Length:</b> feet, meters, inches, centimeters, millimeters, yards', bullet_style))
story.append(Paragraph('<bullet>\u2022</bullet> <b>Pressure:</b> PSI, bar, pascals, kilopascals, megapascals', bullet_style))
story.append(Paragraph("Enter a value and the quick reference table shows all conversions in the same category at once.", body_style))

# Section 6
story.append(Paragraph("6. Tips", section_style))
story.append(Paragraph('<bullet>\u2022</bullet> Enable <b>"Keep Awake"</b> to prevent sensors from going to sleep during long tests', tip_style))
story.append(Paragraph('<bullet>\u2022</bullet> Use the <b>Zero</b> button to remove the weight of rigging or equipment from readings', tip_style))
story.append(Paragraph('<bullet>\u2022</bullet> For extended monitoring, use a longer sample rate (30s or 1 min) to keep file sizes manageable', tip_style))
story.append(Paragraph('<bullet>\u2022</bullet> <b>OSCAR works fully offline</b> \u2014 no internet required for data capture and saving', tip_style))

# Section 7
story.append(Paragraph("7. Need Help?", section_style))
story.append(HRFlowable(width="100%", thickness=1, color=HexColor("#dde3ea"), spaceBefore=2, spaceAfter=10))

contact_data = [
    ["Office Phone", "(713) 643-9990"],
    ["Project Manager Cell", "(281) 967-1130"],
    ["Email", "mgreenleaf@hydrowates.com"],
    ["Website", "www.hydrowates.com"],
    ["Address", "8100 Lockheed Ave. Houston, TX 77061"],
]

contact_table = Table(contact_data, colWidths=[2*inch, 4*inch])
contact_table.setStyle(TableStyle([
    ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
    ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
    ("FONTSIZE", (0, 0), (-1, -1), 10.5),
    ("TEXTCOLOR", (0, 0), (0, -1), dark_blue),
    ("TEXTCOLOR", (1, 0), (1, -1), text_color),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("LINEBELOW", (0, 0), (-1, -2), 0.5, HexColor("#e8ecf0")),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
]))
story.append(contact_table)

story.append(Spacer(1, 30))
story.append(HRFlowable(width="40%", thickness=1, color=gold, spaceBefore=10, spaceAfter=10))
story.append(Paragraph("Hydro-Wates  |  OSCAR v1.0  |  www.hydrowates.com", footer_style))

doc.build(story)
print("PDF created successfully at", output_path)
