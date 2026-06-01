import { Fragment } from 'react';
import { Check } from 'lucide-react';

interface Step {
  label: string;
  description: string;
}

interface AuditWizardStepperProps {
  steps: Step[];
  currentStep: number;
}

export default function AuditWizardStepper({ steps, currentStep }: AuditWizardStepperProps) {
  const compact = steps.length >= 5;

  return (
    <div className="flex w-full min-w-0 items-center overflow-hidden">
      {steps.map((step, i) => {
        const isCompleted = i < currentStep;
        const isCurrent = i === currentStep;
        const lineCompleted = i < currentStep;

        return (
          <Fragment key={i}>
            <div
              className={`flex min-w-0 items-center gap-2 sm:gap-2.5 ${compact ? 'flex-[1_1_0%]' : 'flex-[2_1_0%]'}`}
              title={compact ? `${step.label} — ${step.description}` : undefined}
            >
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-all ${
                  isCompleted
                    ? 'gradient-bg text-white'
                    : isCurrent
                      ? 'border-2 border-brand-primary bg-brand-primary/10 text-brand-primary'
                      : 'bg-gray-100 text-gray-400'
                }`}
              >
                {isCompleted ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <div className="min-w-0">
                <p
                  className={`text-xs font-medium sm:text-sm ${compact ? 'leading-snug' : 'truncate'} ${isCurrent ? 'text-gray-900' : 'text-gray-500'}`}
                >
                  {step.label}
                </p>
                {!compact && (
                  <p className="hidden truncate text-xs text-gray-400 sm:block">{step.description}</p>
                )}
              </div>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`h-px min-h-px self-center bg-gray-200 ${compact ? 'mx-1 min-w-2 flex-[0.5_1_0%] sm:mx-1.5' : 'mx-1 min-w-2 flex-[1_1_0%] self-center sm:mx-2 sm:min-w-4'} ${lineCompleted ? '!bg-brand-primary' : ''}`}
                aria-hidden
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
