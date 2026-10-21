const { Schema, model } = require("mongoose");

const assignmentSubmissionSchema = new Schema(
  {
    student: { type: Schema.Types.ObjectId, ref: "User", required: true },
    course: { type: Schema.Types.ObjectId, ref: "Course", required: true },
    lessonId: { type: Schema.Types.ObjectId, required: true },

    answerType: { type: String, enum: ["text", "link"], required: true },
    answer: { type: String, required: true },

    status: { type: String, enum: ["submitted", "reviewed"], default: "submitted" },
    // optional review fields set by an admin
    reviewer: { type: Schema.Types.ObjectId, ref: "User" },
    reviewNotes: { type: String },
    grade: { type: Number },
  },
  { timestamps: true }
);

// index for the admin list (course filter + newest first) and the student view
assignmentSubmissionSchema.index({ course: 1, createdAt: -1 });
assignmentSubmissionSchema.index({ student: 1, course: 1, createdAt: -1 });

module.exports = model("AssignmentSubmission", assignmentSubmissionSchema);
