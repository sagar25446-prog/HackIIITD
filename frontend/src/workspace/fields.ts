import { STATES } from "./states";

export const FIELD: Record<string, [string, string, string, string[]?]> = {
  service: [
    "Government service",
    "सरकारी सेवा",
    "select",
    [
      "aadhaar",
      "pan",
      "driving_licence",
      "income_certificate",
      "caste_certificate",
      "domicile_certificate",
      "passport",
      "birth_death_certificate",
      "other",
    ],
  ],
  application_stage: ["Application stage", "आवेदन चरण", "text"],
  vehicle_type: ["Vehicle category", "वाहन श्रेणी", "select", ["non_transport", "transport"]],
  learner_issued_on: ["Learner licence issued on", "लर्नर लाइसेंस जारी तिथि", "date"],
  already_has_pan: ["Already have a PAN?", "क्या पहले से पैन है?", "bool"],
  aadhaar_ready: ["Valid Aadhaar with updated KYC?", "अद्यतन KYC वाला वैध आधार है?", "bool"],
  linked_mobile: ["Access to Aadhaar-linked mobile?", "आधार से जुड़े मोबाइल तक पहुँच है?", "bool"],
  representative_assessee: [
    "Representative assessee route applies?",
    "प्रतिनिधि करदाता मार्ग लागू है?",
    "bool",
  ],
  state: ["State", "राज्य", "select", STATES],
  age: ["Age", "उम्र", "number"],
  years_in_state: ["Years resident", "निवास के वर्ष", "number"],
  annual_family_income: ["Annual family income (₹)", "वार्षिक पारिवारिक आय (₹)", "number"],
  annual_personal_income: ["Annual applicant income (₹)", "आवेदक की वार्षिक आय (₹)", "number"],
  gender: ["Gender", "लिंग", "select", ["female", "male", "other"]],
  marital_status: [
    "Marital status",
    "वैवाहिक स्थिति",
    "select",
    ["widowed", "married", "single", "divorced", "separated"],
  ],
  category: ["Category", "वर्ग", "select", ["general", "sc", "st", "obc", "ews"]],
  disability: ["Disability applies?", "दिव्यांगता लागू है?", "bool"],
  has_bank_account: ["Own bank account?", "अपना बैंक खाता?", "bool"],
  receives_other_pension: ["Other pension for this purpose?", "इस उद्देश्य की अन्य पेंशन?", "bool"],
  breadwinner_died_18_59: [
    "Main earner died aged 18–59?",
    "मुख्य कमाने वाले की मृत्यु 18–59 वर्ष में?",
    "bool",
  ],
  existing_policy: ["Existing insurance known?", "मौजूदा बीमा ज्ञात है?", "bool"],
  previous_award: ["Previously selected for CSSS?", "पहले CSSS चयन हुआ?", "bool"],
  marks_percent: ["Previous-year marks (%)", "पिछले वर्ष के अंक (%)", "number"],
  attendance_percent: ["Attendance (%)", "उपस्थिति (%)", "number"],
  course_year: ["Course year (1–5)", "पाठ्यक्रम वर्ष (1–5)", "number"],
  degree_course: ["Degree, not diploma?", "डिग्री, डिप्लोमा नहीं?", "bool"],
  in_full_time_education: ["Regular full-time course?", "नियमित पूर्णकालिक पाठ्यक्रम?", "bool"],
  class12_percentile: ["Class 12 percentile", "कक्षा 12 प्रतिशतक", "number"],
  took_gap_year: ["Gap after Class 12?", "कक्षा 12 के बाद अंतराल?", "bool"],
  other_scholarship: [
    "Other scholarship or reimbursement?",
    "दूसरी छात्रवृत्ति या प्रतिपूर्ति?",
    "bool",
  ],
  nfsa_beneficiary: ["Existing NFSA AAY/PHH beneficiary?", "मौजूदा NFSA AAY/PHH लाभार्थी?", "bool"],
  from_state: ["From state", "किस राज्य से", "select", STATES],
  to_state: ["To state", "किस राज्य में", "select", STATES],
  claimant_relation: [
    "Claimant relationship",
    "दावेदार का संबंध",
    "select",
    ["self", "spouse", "child", "parent", "sibling", "other"],
  ],
  claimant_capacity: [
    "Claims as",
    "किस हैसियत से दावा",
    "select",
    ["holder", "nominee", "legal_heir", "joint_holder", "unknown"],
  ],
  responsible_institution: [
    "Responsible institution (bank, AMC, company)",
    "ज़िम्मेदार संस्था (बैंक, AMC, कंपनी)",
    "text",
  ],
  asset_category: [
    "Asset category",
    "संपत्ति की श्रेणी",
    "select",
    ["bank_deposits", "insurance", "shares_dividends", "mutual_funds", "provident_fund"],
  ],
  institution: ["Institution route ID", "संस्था मार्ग ID", "text"],
};
export function caseFields(kind: string, mode: string) {
  return (
    (
      {
        bereavement: [
          "state",
          "age",
          "gender",
          "marital_status",
          "years_in_state",
          "annual_personal_income",
          "receives_other_pension",
          "has_bank_account",
          "breadwinner_died_18_59",
          "existing_policy",
        ],
        retirement: [
          "state",
          "age",
          "years_in_state",
          "annual_family_income",
          "receives_other_pension",
          "has_bank_account",
        ],
        education: [
          "degree_course",
          "in_full_time_education",
          "other_scholarship",
          ...(mode === "renewal"
            ? ["previous_award", "marks_percent", "attendance_percent", "course_year"]
            : [
                "class12_percentile",
                "annual_family_income",
                "took_gap_year",
                "course_year",
                "category",
                "disability",
              ]),
        ],
        moving: ["nfsa_beneficiary", "from_state", "to_state"],
        paperwork: [
          "service",
          "application_stage",
          "state",
          "age",
          "already_has_pan",
          "aadhaar_ready",
          "linked_mobile",
          "representative_assessee",
          "vehicle_type",
          "learner_issued_on",
        ],
        wapsi: [
          "asset_category",
          "claimant_relation",
          "claimant_capacity",
          "responsible_institution",
        ],
      } as Record<string, string[]>
    )[kind] || []
  );
}
export const choiceLabel = (s: string, hi: boolean) =>
  hi
    ? (
        {
          female: "महिला",
          male: "पुरुष",
          other: "अन्य",
          widowed: "विधवा",
          married: "विवाहित",
          single: "अविवाहित",
          divorced: "तलाकशुदा",
          separated: "अलग रह रहे",
          general: "सामान्य",
          self: "स्वयं",
          spouse: "जीवनसाथी",
          child: "संतान",
          parent: "माता/पिता",
          nominee: "नामित व्यक्ति",
          sibling: "भाई/बहन",
          holder: "स्वयं धारक",
          legal_heir: "कानूनी उत्तराधिकारी",
          joint_holder: "संयुक्त धारक",
          unknown: "अभी पता नहीं",
          bank_deposits: "बैंक जमा",
          insurance: "बीमा",
          shares_dividends: "शेयर / लाभांश",
          mutual_funds: "म्यूचुअल फंड",
          provident_fund: "भविष्य निधि",
        } as Record<string, string>
      )[s] || s
    : s.replaceAll("_", " ");
