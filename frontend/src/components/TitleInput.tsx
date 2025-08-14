import React from 'react';

interface TitleInputProps {
  value: string;
  onChange: (value: string) => void;
  setName: string;
  placeholder?: string;
}

export const TitleInput: React.FC<TitleInputProps> = ({
  value,
  onChange,
  setName,
  placeholder = 'Enter title for this set...'
}) => {
  return (
    <div className="w-full mb-6">
      <label className="block text-sm font-medium text-gray-700 mb-2">
        {setName} Title
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        maxLength={100}
      />
      <p className="text-xs text-gray-500 mt-1">
        {value.length}/100 characters
      </p>
    </div>
  );
};
